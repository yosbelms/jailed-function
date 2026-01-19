import { isFunction, isObject, isThenable } from './util'
import { TimeoutError, MemoryLimitError } from './error'
import { sizeOf, isProtectedProperty, formatBytes } from './util'

enum CheckType {
  Sync,
  Async,
}

interface RuntimeConfig {
  timeout: number
  syncTimeout: number
  memoryLimit: number
}

export class Runtime {
  private config: RuntimeConfig
  private beginTimestamp: number
  private error: Error | void = void 0
  private lastAsyncCheckTimestamp: number
  private lastCheck: CheckType
  private memorySize: number = 0
  private sizeCache: WeakMap<object, number>

  constructor(config: Partial<RuntimeConfig>) {
    this.config = {
      timeout: 1 * 1000 * 60 * 10, // 10mins
      syncTimeout: 100,
      memoryLimit: 1 * 1024 * 1024 * 10, // 10Mb
      ...config,
    }

    this.beginTimestamp = Date.now()
    this.lastAsyncCheckTimestamp = this.beginTimestamp
    this.lastCheck = CheckType.Async
    this.sizeCache = new WeakMap()
  }

  private throwTimeoutError() {
    this.error = new TimeoutError('Timeout error')
    throw this.error
  }

  private throwMemoryLimitError() {
    this.error = new MemoryLimitError(
      `Memory limit error, max: ${formatBytes(this.config.memoryLimit)}, reached: ${formatBytes(this.memorySize)}`
    )
    throw this.error
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

  // memory
  sizeOf(value: any): number {
    if (isObject(value)) {
      let size = this.sizeCache.get(value)
      if (size === void 0) {
        size = sizeOf(value)
        this.sizeCache.set(value, size)
      }
      return size
    } else {
      return sizeOf(value)
    }
  }

  alloc(newAlloc: any, oldAlloc: any = void 0, container: any = void 0) {
    const sizeDiff = this.sizeOf(newAlloc) - this.sizeOf(oldAlloc)
    if (isObject(container) && sizeDiff !== 0) {
      this.sizeCache.set(container, this.sizeOf(container) + sizeDiff)
    }
    this.memorySize = this.memorySize + sizeDiff
    if (this.memorySize > this.config.memoryLimit) {
      this.throwMemoryLimitError()
    }
  }

  captureLazyValue(value: any) {
    if (isFunction(value)) {
      return (...args: any[]) => this.captureLazyValue(value(...args))
    } else if (isThenable(value)) {
      return value.then((result: any) => this.captureLazyValue(result))
    } else {
      this.alloc(value)
      return value
    }
  }

  createProxy(obj: any) {
    this.alloc(obj)
    return new Proxy(obj, {
      set: (obj, prop, value, receiver) => {
        this.alloc(value, obj[prop], obj)
        return Reflect.set(obj, prop, value, receiver)
      },
      deleteProperty: (obj: any, prop: any) => {
        this.alloc(void 0, obj[prop], obj)
        delete obj[prop]
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

  callProp(obj: any, prop: any, ...args: any[]) {
    return isProtectedProperty(prop) ? void 0 : obj[prop](...args)
  }

  setProp(obj: any, prop: any, value: any, operator: string) {
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
    // do not await checkAsync because it is resolving a promise
    // so, it does not overtakes
    this.checkAsync()
    return result
  }

  // Chunk size for spread operations - check timeout every N elements
  private readonly SPREAD_CHUNK_SIZE = 1000

  /**
   * Safely spread arrays with timeout checks.
   * Transforms: [...arr1, x, ...arr2] -> spreadArray([[arr1, true], [x, false], [arr2, true]])
   * @param elements Array of [value, isSpread] tuples
   */
  spreadArray(elements: [any, boolean][]): any[] {
    const result: any[] = []

    for (const [value, isSpread] of elements) {
      if (isSpread) {
        // Spread the iterable in chunks
        if (value == null) continue

        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i += this.SPREAD_CHUNK_SIZE) {
            this.checkSync()
            const end = Math.min(i + this.SPREAD_CHUNK_SIZE, value.length)
            for (let j = i; j < end; j++) {
              result.push(value[j])
            }
          }
        } else if (typeof value[Symbol.iterator] === 'function') {
          // Handle other iterables
          let count = 0
          for (const item of value) {
            if (count++ % this.SPREAD_CHUNK_SIZE === 0) {
              this.checkSync()
            }
            result.push(item)
          }
        }
      } else {
        // Regular element
        result.push(value)
      }
    }

    return this.createProxy(result)
  }

  /**
   * Safely spread objects with timeout checks.
   * Transforms: {...obj1, key: val, ...obj2} -> spreadObject([[obj1, true], [{key: val}, false], [obj2, true]])
   * @param sources Array of [value, isSpread] tuples
   */
  spreadObject(sources: [any, boolean][]): any {
    const result: any = {}

    for (const [source, isSpread] of sources) {
      if (isSpread) {
        // Spread the object in chunks
        if (source == null) continue

        const keys = Object.keys(source)
        for (let i = 0; i < keys.length; i += this.SPREAD_CHUNK_SIZE) {
          this.checkSync()
          const end = Math.min(i + this.SPREAD_CHUNK_SIZE, keys.length)
          for (let j = i; j < end; j++) {
            const key = keys[j]
            if (!isProtectedProperty(key)) {
              result[key] = source[key]
            }
          }
        }
      } else {
        // Regular object literal properties - copy directly
        if (source == null) continue
        const keys = Object.keys(source)
        for (const key of keys) {
          if (!isProtectedProperty(key)) {
            result[key] = source[key]
          }
        }
      }
    }

    return this.createProxy(result)
  }

  /**
   * Safely spread arguments in function calls with timeout checks.
   * Transforms: fn(a, ...args, b) -> spreadCall(fn, [[a, false], [args, true], [b, false]])
   * @param fn The function to call
   * @param args Array of [value, isSpread] tuples
   * @param thisArg Optional this context
   */
  spreadCall(fn: Function, args: [any, boolean][], thisArg?: any): any {
    const flatArgs: any[] = []

    for (const [value, isSpread] of args) {
      if (isSpread) {
        // Spread the iterable in chunks
        if (value == null) continue

        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i += this.SPREAD_CHUNK_SIZE) {
            this.checkSync()
            const end = Math.min(i + this.SPREAD_CHUNK_SIZE, value.length)
            for (let j = i; j < end; j++) {
              flatArgs.push(value[j])
            }
          }
        } else if (typeof value[Symbol.iterator] === 'function') {
          let count = 0
          for (const item of value) {
            if (count++ % this.SPREAD_CHUNK_SIZE === 0) {
              this.checkSync()
            }
            flatArgs.push(item)
          }
        }
      } else {
        flatArgs.push(value)
      }
    }

    return fn.apply(thisArg, flatArgs)
  }
}

export const createRuntime = (config: Partial<RuntimeConfig>) => {
  return new Runtime(config)
}
