import { isProtectedProperty } from './util'
import { Runtime } from './runtime'
import { execInWorker } from './worker'

export interface ChunkSizes {
  default: number
  arrayIteration: number
  stringOperation: number
  objectKeys: number
  encoding: number
}

export interface SizeThresholds {
  stringLength: number
  objectKeys: number
  encodeStringLength: number
  jsonLength: number
  jsonDepth: number
}

export const DEFAULT_CHUNK_SIZES: ChunkSizes = {
  default: 1000,
  arrayIteration: 5000,
  stringOperation: 2000,
  objectKeys: 5000,
  encoding: 1000,
}

export const DEFAULT_SIZE_THRESHOLDS: SizeThresholds = {
  stringLength: 1000,
  objectKeys: 10000,
  encodeStringLength: 10000,
  jsonLength: 100000,
  jsonDepth: 100,
}

let chunkSizes = { ...DEFAULT_CHUNK_SIZES }
let sizeThresholds = { ...DEFAULT_SIZE_THRESHOLDS }

export const configureChunkSizes = (config: Partial<ChunkSizes>): void => {
  chunkSizes = { ...chunkSizes, ...config }
}

export const configureSizeThresholds = (config: Partial<SizeThresholds>): void => {
  sizeThresholds = { ...sizeThresholds, ...config }
}

export const getChunkSizes = (): ChunkSizes => ({ ...chunkSizes })
export const getSizeThresholds = (): SizeThresholds => ({ ...sizeThresholds })

export const isDangerousRegex = (pattern: string): boolean => {
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return true
  if (/\(([^|)]+)\|(\1|[^)]*\1[^)]*)\)[+*{]/.test(pattern)) return true
  if (/\.\*[^*]*\.\*|\.\+[^+]*\.\+/.test(pattern)) return true
  if (/\\[1-9][+*{]/.test(pattern)) return true
  if (/\[[^\]]+\][+*]\s*\[[^\]]+\][+*]/.test(pattern)) return true
  if (/\(\?[=!<][^)]*[+*][^)]*\)[+*]/.test(pattern)) return true
  if (/\(\?<?[=!][^)]*[+*]/.test(pattern)) return true
  if (/\([^()]*\([^()]*[+*][^()]*\)[^()]*\)[+*]/.test(pattern)) return true
  if (/\([^)]*\?[+*][^)]*\)[+*]/.test(pattern)) return true
  return false
}

export const getRegexSource = (regex: any): string | null => {
  try {
    const str = String(regex)
    const lastSlash = str.lastIndexOf('/')
    if (lastSlash > 0 && str[0] === '/') {
      const flags = str.slice(lastSlash + 1)
      if (/^[gimsuy]*$/.test(flags)) {
        return str.slice(1, lastSlash)
      }
    }
  } catch { }

  try {
    if (typeof regex.source === 'string') return regex.source
  } catch { }

  return null
}

export const safeRepeat = (
  runtime: Runtime,
  str: string,
  count: number
): string => {
  if (count < 0 || count === Infinity) {
    throw new RangeError('Invalid count value')
  }
  count = Math.floor(count)
  if (count === 0 || str.length === 0) return ''

  let result = ''
  let base = str

  while (count > 0) {
    runtime.checkSync()
    if (count & 1) {
      result += base
    }
    count >>>= 1
    if (count > 0) {
      base += base
    }
  }

  return result
}

export const safeEncodeURIComponent = (
  checkSync: () => void,
  str: string
): string => {
  if (str.length < sizeThresholds.encodeStringLength) {
    return encodeURIComponent(str)
  }

  const result: string[] = []
  for (let i = 0; i < str.length; i += chunkSizes.encoding) {
    checkSync()
    let end = Math.min(i + chunkSizes.encoding, str.length)
    if (end < str.length) {
      const code = str.charCodeAt(end - 1)
      if (code >= 0xD800 && code <= 0xDBFF) end++
    }
    result.push(encodeURIComponent(str.slice(i, end)))
  }
  return result.join('')
}

export const safeEncodeURI = (
  checkSync: () => void,
  str: string
): string => {
  if (str.length < sizeThresholds.encodeStringLength) {
    return encodeURI(str)
  }

  const result: string[] = []
  for (let i = 0; i < str.length; i += chunkSizes.encoding) {
    checkSync()
    let end = Math.min(i + chunkSizes.encoding, str.length)
    if (end < str.length) {
      const code = str.charCodeAt(end - 1)
      if (code >= 0xD800 && code <= 0xDBFF) end++
    }
    result.push(encodeURI(str.slice(i, end)))
  }
  return result.join('')
}

export const safeArrayFrom = (
  runtime: Runtime,
  arrayLike: any,
  mapFn?: (v: any, k: number) => any,
  thisArg?: any
): any[] => {
  const result: any[] = []

  if (arrayLike != null && typeof arrayLike.length === 'number') {
    const len = arrayLike.length >>> 0
    for (let i = 0; i < len; i += chunkSizes.arrayIteration) {
      runtime.checkSync()
      const chunkEnd = Math.min(i + chunkSizes.arrayIteration, len)
      for (let j = i; j < chunkEnd; j++) {
        const value = arrayLike[j]
        result.push(mapFn ? mapFn.call(thisArg, value, j) : value)
      }
    }
  } else if (arrayLike != null && typeof arrayLike[Symbol.iterator] === 'function') {
    let index = 0
    for (const value of arrayLike) {
      if (index % chunkSizes.arrayIteration === 0) runtime.checkSync()
      result.push(mapFn ? mapFn.call(thisArg, value, index) : value)
      index++
    }
  }

  return result
}

export const safeFill = (
  runtime: Runtime,
  arr: any[],
  value: any,
  start?: number,
  end?: number
): any[] => {
  const len = arr.length
  const relativeStart = start === undefined ? 0 : start
  const relativeEnd = end === undefined ? len : end

  let k = relativeStart < 0 ? Math.max(len + relativeStart, 0) : Math.min(relativeStart, len)
  const finalEnd = relativeEnd < 0 ? Math.max(len + relativeEnd, 0) : Math.min(relativeEnd, len)

  while (k < finalEnd) {
    runtime.checkSync()
    const chunkEnd = Math.min(k + chunkSizes.arrayIteration, finalEnd)
    for (let i = k; i < chunkEnd; i++) {
      arr[i] = value
    }
    k = chunkEnd
  }

  return arr
}

export const spreadArray = (
  runtime: Runtime,
  elements: [any, boolean][]
): any[] => {
  const result: any[] = []

  for (const [value, isSpread] of elements) {
    if (isSpread) {
      if (value == null) continue
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += chunkSizes.arrayIteration) {
          runtime.checkSync()
          const end = Math.min(i + chunkSizes.arrayIteration, value.length)
          for (let j = i; j < end; j++) {
            result.push(value[j])
          }
        }
      } else if (typeof value[Symbol.iterator] === 'function') {
        let count = 0
        for (const item of value) {
          if (count++ % chunkSizes.arrayIteration === 0) runtime.checkSync()
          result.push(item)
        }
      }
    } else {
      result.push(value)
    }
  }

  return result
}

export const spreadObject = (
  runtime: Runtime,
  sources: [any, boolean][]
): any => {
  const result: any = {}

  for (const [source, isSpread] of sources) {
    if (isSpread) {
      if (source == null) continue
      const keys = Object.keys(source)
      for (let i = 0; i < keys.length; i += chunkSizes.objectKeys) {
        runtime.checkSync()
        const end = Math.min(i + chunkSizes.objectKeys, keys.length)
        for (let j = i; j < end; j++) {
          const key = keys[j]
          if (!isProtectedProperty(key)) {
            result[key] = source[key]
          }
        }
      }
    } else {
      if (source == null) continue
      for (const key of Object.keys(source)) {
        if (!isProtectedProperty(key)) {
          result[key] = source[key]
        }
      }
    }
  }

  return result
}

export const spreadCall = (
  runtime: Runtime,
  fn: Function,
  args: [any, boolean][],
  thisArg?: any
): any => {
  const flatArgs: any[] = []

  for (const [value, isSpread] of args) {
    if (isSpread) {
      if (value == null) continue
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += chunkSizes.arrayIteration) {
          runtime.checkSync()
          const end = Math.min(i + chunkSizes.arrayIteration, value.length)
          for (let j = i; j < end; j++) {
            flatArgs.push(value[j])
          }
        }
      } else if (typeof value[Symbol.iterator] === 'function') {
        let count = 0
        for (const item of value) {
          if (count++ % chunkSizes.arrayIteration === 0) runtime.checkSync()
          flatArgs.push(item)
        }
      }
    } else {
      flatArgs.push(value)
    }
  }

  return fn.apply(thisArg, flatArgs)
}

export const safeArraySort = (
  runtime: Runtime,
  arr: any[],
  compareFn?: (a: any, b: any) => number
): any[] => {
  if (arr.length <= chunkSizes.arrayIteration) {
    return arr.sort(compareFn)
  }

  let iterations = 0
  const wrappedCompare = compareFn
    ? (a: any, b: any) => {
      if (++iterations % chunkSizes.arrayIteration === 0) runtime.checkSync()
      return compareFn(a, b)
    }
    : undefined

  return arr.sort(wrappedCompare)
}

export const safeArrayReverse = (
  runtime: Runtime,
  arr: any[]
): any[] => {
  const len = arr.length
  const mid = Math.floor(len / 2)

  for (let i = 0; i < mid; i += chunkSizes.arrayIteration) {
    runtime.checkSync()
    const end = Math.min(i + chunkSizes.arrayIteration, mid)
    for (let j = i; j < end; j++) {
      const temp = arr[j]
      arr[j] = arr[len - 1 - j]
      arr[len - 1 - j] = temp
    }
  }

  return arr
}

export const safeArrayFlat = (
  runtime: Runtime,
  arr: any[],
  depth: number = 1
): any[] => {
  const result: any[] = []

  const flatten = (input: any[], d: number) => {
    for (let i = 0; i < input.length; i += chunkSizes.arrayIteration) {
      runtime.checkSync()
      const end = Math.min(i + chunkSizes.arrayIteration, input.length)
      for (let j = i; j < end; j++) {
        if (Array.isArray(input[j]) && d > 0) {
          flatten(input[j], d - 1)
        } else {
          result.push(input[j])
        }
      }
    }
  }

  flatten(arr, depth)
  return result
}

export const safeArrayFlatMap = (
  runtime: Runtime,
  arr: any[],
  callback: (value: any, index: number, array: any[]) => any,
  thisArg?: any
): any[] => {
  const result: any[] = []

  for (let i = 0; i < arr.length; i += chunkSizes.arrayIteration) {
    runtime.checkSync()
    const end = Math.min(i + chunkSizes.arrayIteration, arr.length)
    for (let j = i; j < end; j++) {
      const mapped = callback.call(thisArg, arr[j], j, arr)
      if (Array.isArray(mapped)) {
        result.push(...mapped)
      } else {
        result.push(mapped)
      }
    }
  }

  return result
}

export const safeArrayJoin = (
  runtime: Runtime,
  arr: any[],
  separator: string = ','
): string => {
  if (arr.length <= chunkSizes.arrayIteration) {
    return arr.join(separator)
  }

  const parts: string[] = []

  for (let i = 0; i < arr.length; i += chunkSizes.arrayIteration) {
    runtime.checkSync()
    const end = Math.min(i + chunkSizes.arrayIteration, arr.length)
    parts.push(arr.slice(i, end).join(separator))
  }

  return parts.join(separator)
}

export const safeArrayConcat = (
  runtime: Runtime,
  arr: any[],
  ...items: any[]
): any[] => {
  const result = [...arr]

  for (const item of items) {
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i += chunkSizes.arrayIteration) {
        runtime.checkSync()
        const end = Math.min(i + chunkSizes.arrayIteration, item.length)
        for (let j = i; j < end; j++) {
          result.push(item[j])
        }
      }
    } else {
      result.push(item)
    }
  }

  return result
}

export const safeArrayIndexOf = (
  runtime: Runtime,
  arr: any[],
  searchElement: any,
  fromIndex: number = 0
): number => {
  const len = arr.length
  let k = fromIndex < 0 ? Math.max(len + fromIndex, 0) : fromIndex

  while (k < len) {
    if (k % chunkSizes.arrayIteration === 0) runtime.checkSync()
    if (arr[k] === searchElement) return k
    k++
  }

  return -1
}

export const safeArrayLastIndexOf = (
  runtime: Runtime,
  arr: any[],
  searchElement: any,
  fromIndex?: number
): number => {
  const len = arr.length
  let k = fromIndex === undefined ? len - 1 : (fromIndex < 0 ? len + fromIndex : Math.min(fromIndex, len - 1))
  let iterations = 0

  while (k >= 0) {
    if (++iterations % chunkSizes.arrayIteration === 0) runtime.checkSync()
    if (arr[k] === searchElement) return k
    k--
  }

  return -1
}

export const safeArrayIncludes = (
  runtime: Runtime,
  arr: any[],
  searchElement: any,
  fromIndex: number = 0
): boolean => {
  return safeArrayIndexOf(runtime, arr, searchElement, fromIndex) !== -1
}

export const safeArrayFind = (
  runtime: Runtime,
  arr: any[],
  predicate: (value: any, index: number, obj: any[]) => boolean,
  thisArg?: any
): any => {
  for (let i = 0; i < arr.length; i++) {
    if (i % chunkSizes.arrayIteration === 0) runtime.checkSync()
    if (predicate.call(thisArg, arr[i], i, arr)) return arr[i]
  }

  return undefined
}

export const safeArrayFindIndex = (
  runtime: Runtime,
  arr: any[],
  predicate: (value: any, index: number, obj: any[]) => boolean,
  thisArg?: any
): number => {
  for (let i = 0; i < arr.length; i++) {
    if (i % chunkSizes.arrayIteration === 0) runtime.checkSync()
    if (predicate.call(thisArg, arr[i], i, arr)) return i
  }

  return -1
}

export const safeArrayEvery = (
  runtime: Runtime,
  arr: any[],
  predicate: (value: any, index: number, obj: any[]) => boolean,
  thisArg?: any
): boolean => {
  for (let i = 0; i < arr.length; i++) {
    if (i % chunkSizes.arrayIteration === 0) runtime.checkSync()
    if (!predicate.call(thisArg, arr[i], i, arr)) return false
  }

  return true
}

export const safeArraySome = (
  runtime: Runtime,
  arr: any[],
  predicate: (value: any, index: number, obj: any[]) => boolean,
  thisArg?: any
): boolean => {
  for (let i = 0; i < arr.length; i++) {
    if (i % chunkSizes.arrayIteration === 0) runtime.checkSync()
    if (predicate.call(thisArg, arr[i], i, arr)) return true
  }

  return false
}

export const safeArrayFilter = (
  runtime: Runtime,
  arr: any[],
  predicate: (value: any, index: number, obj: any[]) => boolean,
  thisArg?: any
): any[] => {
  const result: any[] = []

  for (let i = 0; i < arr.length; i++) {
    if (i % chunkSizes.arrayIteration === 0) runtime.checkSync()
    if (predicate.call(thisArg, arr[i], i, arr)) result.push(arr[i])
  }

  return result
}

export const safeArrayMap = (
  runtime: Runtime,
  arr: any[],
  callback: (value: any, index: number, obj: any[]) => any,
  thisArg?: any
): any[] => {
  const result: any[] = []

  for (let i = 0; i < arr.length; i++) {
    if (i % chunkSizes.arrayIteration === 0) runtime.checkSync()
    result.push(callback.call(thisArg, arr[i], i, arr))
  }

  return result
}

export const safeArrayReduce = (
  runtime: Runtime,
  arr: any[],
  callback: (acc: any, value: any, index: number, obj: any[]) => any,
  initialValue?: any,
  hasInitialValue: boolean = true
): any => {
  let acc = initialValue
  let startIndex = 0

  if (!hasInitialValue) {
    if (arr.length === 0) throw new TypeError('Reduce of empty array with no initial value')
    acc = arr[0]
    startIndex = 1
  }

  for (let i = startIndex; i < arr.length; i++) {
    if (i % chunkSizes.arrayIteration === 0) runtime.checkSync()
    acc = callback(acc, arr[i], i, arr)
  }

  return acc
}

export const safeArrayReduceRight = (
  runtime: Runtime,
  arr: any[],
  callback: (acc: any, value: any, index: number, obj: any[]) => any,
  initialValue?: any,
  hasInitialValue: boolean = true
): any => {
  let acc = initialValue
  let startIndex = arr.length - 1

  if (!hasInitialValue) {
    if (arr.length === 0) throw new TypeError('Reduce of empty array with no initial value')
    acc = arr[arr.length - 1]
    startIndex = arr.length - 2
  }

  let iterations = 0
  for (let i = startIndex; i >= 0; i--) {
    if (++iterations % chunkSizes.arrayIteration === 0) runtime.checkSync()
    acc = callback(acc, arr[i], i, arr)
  }

  return acc
}

export const safeArrayCopyWithin = (
  runtime: Runtime,
  arr: any[],
  target: number,
  start: number = 0,
  end?: number
): any[] => {
  const len = arr.length

  let to = target < 0 ? Math.max(len + target, 0) : Math.min(target, len)
  let from = start < 0 ? Math.max(len + start, 0) : Math.min(start, len)
  const finalEnd = end === undefined ? len : (end < 0 ? Math.max(len + end, 0) : Math.min(end, len))
  let count = Math.min(finalEnd - from, len - to)

  const temp = arr.slice(from, from + count)

  for (let i = 0; i < count; i += chunkSizes.arrayIteration) {
    runtime.checkSync()
    const chunkEnd = Math.min(i + chunkSizes.arrayIteration, count)
    for (let j = i; j < chunkEnd; j++) {
      arr[to + j] = temp[j]
    }
  }

  return arr
}

export const safeObjectAssign = (
  runtime: Runtime,
  target: any,
  ...sources: any[]
): any => {
  for (const source of sources) {
    if (source == null) continue
    const keys = Object.keys(source)

    for (let i = 0; i < keys.length; i += chunkSizes.objectKeys) {
      runtime.checkSync()
      const end = Math.min(i + chunkSizes.objectKeys, keys.length)
      for (let j = i; j < end; j++) {
        const key = keys[j]
        if (!isProtectedProperty(key)) {
          target[key] = source[key]
        }
      }
    }
  }

  return target
}

export const safeObjectFromEntries = (
  runtime: Runtime,
  iterable: Iterable<[string, any]>
): any => {
  const result: any = {}
  let count = 0

  for (const [key, value] of iterable) {
    if (count++ % chunkSizes.objectKeys === 0) runtime.checkSync()
    if (!isProtectedProperty(String(key))) {
      result[key] = value
    }
  }

  return result
}

export const safeStringNormalize = (
  runtime: Runtime,
  str: string,
  form?: string
): string => {
  if (str.length <= chunkSizes.stringOperation) {
    return str.normalize(form as any)
  }

  const result: string[] = []
  for (let i = 0; i < str.length; i += chunkSizes.stringOperation) {
    runtime.checkSync()
    let end = Math.min(i + chunkSizes.stringOperation, str.length)
    if (end < str.length) {
      const code = str.charCodeAt(end - 1)
      if (code >= 0xD800 && code <= 0xDBFF) end++
    }
    result.push(str.slice(i, end).normalize(form as any))
  }

  return result.join('')
}

export const safeStringPadStart = (
  runtime: Runtime,
  str: string,
  targetLength: number,
  padString: string = ' '
): string => {
  runtime.checkSync()
  return str.padStart(targetLength, padString)
}

export const safeStringPadEnd = (
  runtime: Runtime,
  str: string,
  targetLength: number,
  padString: string = ' '
): string => {
  runtime.checkSync()
  return str.padEnd(targetLength, padString)
}

export const safeStringToLowerCase = (
  runtime: Runtime,
  str: string
): string => {
  if (str.length <= chunkSizes.stringOperation) {
    return str.toLowerCase()
  }

  const result: string[] = []
  for (let i = 0; i < str.length; i += chunkSizes.stringOperation) {
    runtime.checkSync()
    result.push(str.slice(i, Math.min(i + chunkSizes.stringOperation, str.length)).toLowerCase())
  }

  return result.join('')
}

export const safeStringToUpperCase = (
  runtime: Runtime,
  str: string
): string => {
  if (str.length <= chunkSizes.stringOperation) {
    return str.toUpperCase()
  }

  const result: string[] = []
  for (let i = 0; i < str.length; i += chunkSizes.stringOperation) {
    runtime.checkSync()
    result.push(str.slice(i, Math.min(i + chunkSizes.stringOperation, str.length)).toUpperCase())
  }

  return result.join('')
}

export const safeStringToLocaleLowerCase = (
  runtime: Runtime,
  str: string,
  locales?: string | string[]
): string => {
  if (str.length <= chunkSizes.stringOperation) {
    return str.toLocaleLowerCase(locales)
  }

  const result: string[] = []
  for (let i = 0; i < str.length; i += chunkSizes.stringOperation) {
    runtime.checkSync()
    result.push(str.slice(i, Math.min(i + chunkSizes.stringOperation, str.length)).toLocaleLowerCase(locales))
  }

  return result.join('')
}

export const safeStringToLocaleUpperCase = (
  runtime: Runtime,
  str: string,
  locales?: string | string[]
): string => {
  if (str.length <= chunkSizes.stringOperation) {
    return str.toLocaleUpperCase(locales)
  }

  const result: string[] = []
  for (let i = 0; i < str.length; i += chunkSizes.stringOperation) {
    runtime.checkSync()
    result.push(str.slice(i, Math.min(i + chunkSizes.stringOperation, str.length)).toLocaleUpperCase(locales))
  }

  return result.join('')
}

export const safeStringTrim = (
  runtime: Runtime,
  str: string
): string => {
  runtime.checkSync()
  return str.trim()
}

export const safeStringTrimStart = (
  runtime: Runtime,
  str: string
): string => {
  runtime.checkSync()
  return str.trimStart()
}

export const safeStringTrimEnd = (
  runtime: Runtime,
  str: string
): string => {
  runtime.checkSync()
  return str.trimEnd()
}

export const safeStringSubstring = (
  runtime: Runtime,
  str: string,
  start: number,
  end?: number
): string => {
  runtime.checkSync()
  return str.substring(start, end)
}

export const safeStringSlice = (
  runtime: Runtime,
  str: string,
  start?: number,
  end?: number
): string => {
  runtime.checkSync()
  return str.slice(start, end)
}

export const safeStringStartsWith = (
  runtime: Runtime,
  str: string,
  searchString: string,
  position?: number
): boolean => {
  runtime.checkSync()
  return str.startsWith(searchString, position)
}

export const safeStringEndsWith = (
  runtime: Runtime,
  str: string,
  searchString: string,
  length?: number
): boolean => {
  runtime.checkSync()
  return str.endsWith(searchString, length)
}

export const safeStringIncludes = (
  runtime: Runtime,
  str: string,
  searchString: string,
  position?: number
): boolean => {
  if (str.length <= chunkSizes.stringOperation) {
    return str.includes(searchString, position)
  }

  const start = position ?? 0
  const searchLen = searchString.length

  for (let i = start; i <= str.length - searchLen; i += chunkSizes.stringOperation) {
    runtime.checkSync()
    const end = Math.min(i + chunkSizes.stringOperation + searchLen - 1, str.length)
    const chunk = str.slice(i, end)
    const idx = chunk.indexOf(searchString)
    if (idx !== -1) return true
  }

  return false
}

export const safeJSONParse = (
  runtime: Runtime,
  text: string,
  reviver?: (key: string, value: any) => any
): any => {
  if (text.length > sizeThresholds.jsonLength) {
    return execInWorker(JSON, 'parse', [text, reviver], runtime.getSyncTimeout())
  }

  runtime.checkSync()
  const result = JSON.parse(text, reviver)
  return result
}

export const safeJSONStringify = (
  runtime: Runtime,
  value: any,
  replacer?: any,
  space?: string | number
): string => {
  runtime.checkSync()

  let totalKeys = 0
  const MAX_KEYS = 10000

  const checkComplexity = (obj: any, currentDepth: number): void => {
    if (currentDepth > sizeThresholds.jsonDepth) {
      throw new Error('Object too complex for inline JSON.stringify')
    }
    if (obj && typeof obj === 'object') {
      const keys = Object.keys(obj)
      totalKeys += keys.length
      if (totalKeys > MAX_KEYS) {
        throw new Error('Object too complex for inline JSON.stringify')
      }
      for (const key of keys) {
        checkComplexity(obj[key], currentDepth + 1)
      }
    }
  }

  try {
    checkComplexity(value, 0)
  } catch {
    return execInWorker(JSON, 'stringify', [value, replacer, space], runtime.getSyncTimeout())
  }

  return JSON.stringify(value, replacer, space)
}

export { execInWorker }
