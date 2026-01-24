import { isFunction, isThenable } from './util'
import { TimeoutError, MemoryLimitError } from './error'
import { isProtectedProperty, formatBytes } from './util'
import {
  execInWorker,
  safeRepeat,
  safeArrayFrom,
  safeFill,
  spreadArray,
  spreadObject,
  spreadCall,
  safeObjectAssign,
  safeObjectFromEntries,
  safeArraySort,
  safeArrayReverse,
  safeArrayFlat,
  safeArrayFlatMap,
  safeArrayJoin,
  safeArrayConcat,
  safeArrayIndexOf,
  safeArrayLastIndexOf,
  safeArrayIncludes,
  safeArrayFind,
  safeArrayFindIndex,
  safeArrayEvery,
  safeArraySome,
  safeArrayFilter,
  safeArrayMap,
  safeArrayReduce,
  safeArrayReduceRight,
  safeArrayCopyWithin,
  safeStringNormalize,
  safeStringPadStart,
  safeStringPadEnd,
  safeStringToLowerCase,
  safeStringToUpperCase,
  safeStringToLocaleLowerCase,
  safeStringToLocaleUpperCase,
  safeStringTrim,
  safeStringTrimStart,
  safeStringTrimEnd,
  safeStringSubstring,
  safeStringSlice,
  safeStringStartsWith,
  safeStringEndsWith,
  safeStringIncludes,
  safeJSONParse,
  safeJSONStringify,
  isDangerousRegex,
  getRegexSource,
  getSizeThresholds,
} from './safe-overrides'

// All string methods that need special handling
const STRING_METHODS = new Set([
  // Regex-capable (high-risk)
  'match', 'replace', 'search', 'split',
  // Safe wrappers
  'repeat', 'normalize', 'padStart', 'padEnd',
  'toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase',
  'trim', 'trimStart', 'trimEnd', 'substring', 'slice',
  'startsWith', 'endsWith', 'includes'
])

const REGEX_STRING_METHODS = new Set(['match', 'replace', 'search', 'split'])
const REGEXP_METHODS = new Set(['exec', 'test'])

const OBJECT_METHODS = new Set([
  'keys', 'values', 'entries', 'assign', 'freeze', 'seal',
  'getOwnPropertyNames', 'getOwnPropertySymbols', 'fromEntries'
])

const ARRAY_METHODS = new Set([
  'fill', 'sort', 'reverse', 'flat', 'flatMap', 'join', 'concat',
  'indexOf', 'lastIndexOf', 'includes', 'find', 'findIndex',
  'every', 'some', 'filter', 'map', 'reduce', 'reduceRight', 'copyWithin'
])

enum CheckType {
  Sync,
  Async,
}

interface RuntimeConfig {
  timeout: number
  syncTimeout: number
  memoryLimit: number
  enableNativeProtection: boolean
  mutationTreshold: number
}

export class Runtime {
  private config: RuntimeConfig
  private beginTimestamp: number
  private error: Error | void = void 0
  private lastAsyncCheckTimestamp: number
  private lastCheck: CheckType
  private memorySize: number = 0

  constructor(config: Partial<RuntimeConfig>) {
    this.config = {
      timeout: 1 * 1000 * 60 * 10,
      syncTimeout: 100,
      memoryLimit: 1 * 1024 * 1024 * 10,
      enableNativeProtection: true,
      mutationTreshold: 100,
      ...config,
    }

    this.beginTimestamp = Date.now()
    this.lastAsyncCheckTimestamp = this.beginTimestamp
    this.lastCheck = CheckType.Async
  }

  private throwTimeoutError() {
    this.error = new TimeoutError('Timeout error')
    throw this.error
  }

  private throwMemoryLimitError(): never {
    this.error = new MemoryLimitError(
      `Memory limit error, max: ${formatBytes(this.config.memoryLimit)}, reached: ${formatBytes(this.memorySize)}`
    )
    throw this.error
  }

  getSyncTimeout(): number {
    return this.config.syncTimeout
  }

  sizeOf(value: any) {
    if (value === null || value === undefined) return 8
    switch (typeof value) {
      case 'string': return value.length * 2 + 40
      case 'number': return 8
      case 'boolean': return 8
      case 'object':
        if (Array.isArray(value)) return 64 + value.length * 8
        let size = 64
        for (let key in value) {
          size += this.sizeOf(key)
          this.checkAlloc(size)
        }
        return 64 + Object.keys(value).length * 16
      case 'function': return 64
      default: return 8
    }
  }

  checkAlloc(bytes: number): void {
    this.memorySize += bytes
    if (this.memorySize > this.config.memoryLimit) {
      this.throwMemoryLimitError()
    }
  }

  checkSync() {
    if (this.error) this.throwTimeoutError()

    const now = Date.now()
    const { syncTimeout, timeout } = this.config
    if (
      this.lastCheck === CheckType.Sync
      && ((now - this.lastAsyncCheckTimestamp > syncTimeout) || (now - this.beginTimestamp > timeout))
    ) {
      this.throwTimeoutError()
    }
    this.lastCheck = CheckType.Sync
  }

  checkAsync() {
    if (this.error) this.throwTimeoutError()

    const now = Date.now()
    const { timeout } = this.config
    if (now - this.beginTimestamp > timeout) {
      this.throwTimeoutError()
    }
    this.lastAsyncCheckTimestamp = now
    this.lastCheck = CheckType.Async
  }

  // Proxy-based incremental memory tracking
  createProxy(obj: any) {
    if (obj === null || typeof obj !== 'object') {
      return obj
    }

    const runtime = this
    runtime.checkAlloc(this.sizeOf(obj))

    const mutationTreshold = this.config.mutationTreshold
    let mutationCount = 0

    return new Proxy(obj, {
      set(target, prop, value, receiver) {
        if (isProtectedProperty(String(prop))) return true

        if (mutationCount > mutationTreshold) {
          const hasProperty = Object.prototype.hasOwnProperty.call(target, prop)
          const oldSize = hasProperty ? runtime.sizeOf(target[prop]) : 0
          const newSize = runtime.sizeOf(value)
          const keyOverhead = hasProperty ? 0 : (Array.isArray(target) ? 8 : runtime.sizeOf(String(prop)))
          runtime.checkAlloc(newSize - oldSize + keyOverhead)
        }

        mutationCount++
        return Reflect.set(target, prop, value, receiver)
      },
      deleteProperty(target, prop) {
        if (isProtectedProperty(String(prop))) return true

        if (mutationCount > mutationTreshold) {
          if (Object.prototype.hasOwnProperty.call(target, prop)) {
            const oldSize = runtime.sizeOf(target[prop])
            const keyOverhead = Array.isArray(target) ? 8 : runtime.sizeOf(String(prop))
            runtime.checkAlloc(-(oldSize + keyOverhead))
          }
        }

        mutationCount--
        delete target[prop]
        return true
      }
    })
  }

  createArr(arr: any[]) {
    return this.createProxy(arr)
  }

  createObj(obj: any) {
    return this.createProxy(obj)
  }

  getProp(obj: any, prop: any) {
    let val = isProtectedProperty(prop) ? void 0 : obj[prop]
    if (isFunction(val)) {
      val = obj[prop].bind(obj)
    }
    return this.captureLazyValue(val)
  }

  private captureLazyValue(value: any) {
    if (isFunction(value)) {
      return (...args: any[]) => this.captureLazyValue(value(...args))
    } else if (isThenable(value)) {
      return value.then((result: any) => this.captureLazyValue(result))
    } else {
      if (value !== null && typeof value === 'object') {
        this.checkAlloc(this.sizeOf(value))
      }
      return value
    }
  }

  private isRegExp(obj: any): boolean {
    if (!obj) return false

    try {
      if (Object.prototype.toString.call(obj) === '[object RegExp]') return true
    } catch { }

    try {
      if (typeof obj === 'object') {
        const str = String(obj)
        if (/^\/.*\/[gimsuy]*$/.test(str)) return true
      }
    } catch { }

    try {
      if (obj && typeof obj === 'object' &&
        typeof obj.test === 'function' &&
        typeof obj.exec === 'function' &&
        typeof obj.source === 'string' &&
        typeof obj.flags === 'string') {
        return true
      }
    } catch { }

    return false
  }

  private shouldUseWorker(obj: any, prop: string, args: any[]): boolean {
    if (!this.config.enableNativeProtection) return false

    // String regex methods - check if regex is dangerous or string is large
    if (typeof obj === 'string' && REGEX_STRING_METHODS.has(prop)) {
      const regexArg = args[0]
      if (this.isRegExp(regexArg)) {
        const source = getRegexSource(regexArg)
        if (source && isDangerousRegex(source)) return true
        if (source) return false
      }
      return obj.length >= getSizeThresholds().stringLength
    }

    // RegExp methods - check if pattern is dangerous or input is large
    if (this.isRegExp(obj) && REGEXP_METHODS.has(prop)) {
      const source = getRegexSource(obj)
      if (source && isDangerousRegex(source)) return true
      if (source) return false
      const inputStr = args[0]
      return typeof inputStr === 'string' && inputStr.length >= getSizeThresholds().stringLength
    }

    return false
  }

  private wrapResult(result: any): any {
    if (result === null || result === undefined) return result
    if (typeof result === 'string') {
      this.checkAlloc(result.length * 2)
      return result
    }
    if (Array.isArray(result)) {
      return this.createProxy(result)
    }
    if (typeof result === 'object') {
      return this.createProxy(result)
    }
    return result
  }

  private callSafeMethod(obj: any, prop: string, args: any[]): { handled: boolean, value: any } {
    const handled = (value: any) => ({ handled: true, value })
    const notHandled = { handled: false, value: undefined }

    // Object static methods
    if (obj === Object && OBJECT_METHODS.has(prop)) {
      const target = args[0]
      switch (prop) {
        case 'keys': return handled(Object.keys(target))
        case 'values': return handled(Object.values(target))
        case 'entries': return handled(Object.entries(target))
        case 'assign': return handled(safeObjectAssign(this, target, ...args.slice(1)))
        case 'freeze': return handled(Object.freeze(target))
        case 'seal': return handled(Object.seal(target))
        case 'getOwnPropertyNames': return handled(Object.getOwnPropertyNames(target))
        case 'getOwnPropertySymbols': return handled(Object.getOwnPropertySymbols(target))
        case 'fromEntries': return handled(safeObjectFromEntries(this, target))
      }
    }

    // JSON methods
    if (obj === JSON) {
      if (prop === 'parse') return handled(safeJSONParse(this, args[0], args[1]))
      if (prop === 'stringify') return handled(safeJSONStringify(this, args[0], args[1], args[2]))
    }

    // Array static methods
    if (obj === Array && prop === 'from') {
      return handled(safeArrayFrom(this, args[0], args[1], args[2]))
    }

    // Array instance methods
    if (Array.isArray(obj) && ARRAY_METHODS.has(prop)) {
      switch (prop) {
        case 'fill': return handled(safeFill(this, obj, args[0], args[1], args[2]))
        case 'sort': return handled(safeArraySort(this, obj, args[0]))
        case 'reverse': return handled(safeArrayReverse(this, obj))
        case 'flat': return handled(safeArrayFlat(this, obj, args[0]))
        case 'flatMap': return handled(safeArrayFlatMap(this, obj, args[0], args[1]))
        case 'join': return handled(safeArrayJoin(this, obj, args[0]))
        case 'concat': return handled(safeArrayConcat(this, obj, ...args))
        case 'indexOf': return handled(safeArrayIndexOf(this, obj, args[0], args[1]))
        case 'lastIndexOf': return handled(safeArrayLastIndexOf(this, obj, args[0], args[1]))
        case 'includes': return handled(safeArrayIncludes(this, obj, args[0], args[1]))
        case 'find': return handled(safeArrayFind(this, obj, args[0], args[1]))
        case 'findIndex': return handled(safeArrayFindIndex(this, obj, args[0], args[1]))
        case 'every': return handled(safeArrayEvery(this, obj, args[0], args[1]))
        case 'some': return handled(safeArraySome(this, obj, args[0], args[1]))
        case 'filter': return handled(safeArrayFilter(this, obj, args[0], args[1]))
        case 'map': return handled(safeArrayMap(this, obj, args[0], args[1]))
        case 'reduce': return handled(safeArrayReduce(this, obj, args[0], args[1], args.length >= 2))
        case 'reduceRight': return handled(safeArrayReduceRight(this, obj, args[0], args[1], args.length >= 2))
        case 'copyWithin': return handled(safeArrayCopyWithin(this, obj, args[0], args[1], args[2]))
      }
    }

    // String instance methods
    if (typeof obj === 'string' && STRING_METHODS.has(prop)) {
      // Regex-capable methods - may need worker
      if (REGEX_STRING_METHODS.has(prop)) {
        if (this.shouldUseWorker(obj, prop, args)) {
          return handled(execInWorker(obj, prop, args, this.config.syncTimeout))
        }
        return handled((obj as any)[prop](...args))
      }
      // Safe string methods
      switch (prop) {
        case 'repeat': return handled(safeRepeat(this, obj, args[0]))
        case 'normalize': return handled(safeStringNormalize(this, obj, args[0]))
        case 'padStart': return handled(safeStringPadStart(this, obj, args[0], args[1]))
        case 'padEnd': return handled(safeStringPadEnd(this, obj, args[0], args[1]))
        case 'toLowerCase': return handled(safeStringToLowerCase(this, obj))
        case 'toUpperCase': return handled(safeStringToUpperCase(this, obj))
        case 'toLocaleLowerCase': return handled(safeStringToLocaleLowerCase(this, obj, args[0]))
        case 'toLocaleUpperCase': return handled(safeStringToLocaleUpperCase(this, obj, args[0]))
        case 'trim': return handled(safeStringTrim(this, obj))
        case 'trimStart': return handled(safeStringTrimStart(this, obj))
        case 'trimEnd': return handled(safeStringTrimEnd(this, obj))
        case 'substring': return handled(safeStringSubstring(this, obj, args[0], args[1]))
        case 'slice': return handled(safeStringSlice(this, obj, args[0], args[1]))
        case 'startsWith': return handled(safeStringStartsWith(this, obj, args[0], args[1]))
        case 'endsWith': return handled(safeStringEndsWith(this, obj, args[0], args[1]))
        case 'includes': return handled(safeStringIncludes(this, obj, args[0], args[1]))
      }
    }

    // RegExp instance methods - may need worker
    if (this.isRegExp(obj) && REGEXP_METHODS.has(prop)) {
      if (this.shouldUseWorker(obj, prop, args)) {
        return handled(execInWorker(obj, prop, args, this.config.syncTimeout))
      }
      return handled(obj[prop](...args))
    }

    return notHandled
  }

  callProp(obj: any, prop: any, ...args: any[]) {
    if (isProtectedProperty(prop)) return void 0

    const result = this.callSafeMethod(obj, prop, args)
    if (result.handled) {
      return this.wrapResult(result.value)
    }

    return obj[prop](...args)
  }

  setProp(obj: any, prop: any, value: any, _operator: string) {
    if (isFunction(value)) {
      throw new Error('Object does not accept function')
    }
    return isProtectedProperty(prop) ? void 0 : obj[prop] = value
  }

  computedProp(prop: string) {
    return isProtectedProperty(prop) ? void 0 : prop
  }

  async awaitPromise(promise: Promise<any>) {
    const result = await promise
    this.checkAsync()
    return result
  }

  spreadArray(elements: [any, boolean][]): any[] {
    return spreadArray(this, elements)
  }

  spreadObject(sources: [any, boolean][]): any {
    return spreadObject(this, sources)
  }

  spreadCall(fn: Function, args: [any, boolean][], thisArg?: any): any {
    return spreadCall(this, fn, args, thisArg)
  }
}

export const createRuntime = (config: Partial<RuntimeConfig>) => {
  return new Runtime(config)
}
