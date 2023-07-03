// https://www.mattzeunert.com/2016/07/24/javascript-array-object-sizes.html
// Though, those sizes represents the worst case

export const sizeOf = (obj: any) => {
  let bytes = 2
  if (obj === null || obj === void 0) {
    bytes += 6
  } else {
    switch (typeof obj) {
      case 'string':
        bytes += obj.length * 2
        break
      case 'number':
        bytes += 8
        break
      case 'boolean':
        bytes += 8
        break
      case 'function':
      case 'object':
        const objClass = Object.prototype.toString.call(obj).slice(8, -1)
        switch (objClass) {
          case 'Object':
          case 'Array':
          case 'Function':
            bytes += 64
            for (let key in obj) {
              if (obj.hasOwnProperty(key)) {
                bytes += sizeOf(obj[key]) + sizeOf(key)
              }
            }
            if (objClass !== 'Function') {
              break
            }
          default:
            bytes += sizeOf(obj.toString())
        }
        break
    }
  }
  return bytes
}

const protectedProperty = new Map([
  'prototype',
  ...Object.getOwnPropertyNames(Object.prototype),
].map(k => [k, void 0]))

export const isProtectedProperty = (prop: string) => protectedProperty.has(prop)

export const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

const identRegex = /^[$A-Z_][0-9A-Z_$]*$/i
export const isValidIdentifier = (name: string) => identRegex.test(name)

export const createGetTrap = (allowedProperties: string[]) => {
  const map = new Map(allowedProperties.map(prop => [prop, true]))
  return {
    get(target: any, prop: any, receiver: any) {
      if (map.has(prop)) {
        return readOnlyTraps.get(target, prop, receiver)
      }
    }
  }
}

const readOnlySymbol = Symbol('read-only')

export const isReadOnly = (obj: any) => !isPrimitive(obj) && obj[readOnlySymbol]
export const identity = (a: any) => a
export const noop = () => { }
export const secs = (s: number) => s * 1000
export const mins = (m: number) => secs(m) * 60

export const isObject = (obj: any) => typeof obj === 'object' && obj !== null
export const isFunction = (fn: any) => typeof fn === 'function'
export const isPrimitive = (v: any) => v == null || (!isFunction(v) && !isObject(v))
export const isThenable = (v: any) => v && isFunction(v.then)
export const isArray = Array.isArray.bind(Array)
export const isString = (v: any) => typeof v === 'string'
export const isProduction = () => {
  const { NODE_ENV } = process.env
  return NODE_ENV === 'production'
}
export const getConsole = () => (isProduction()
  ? { log: noop, warn: noop, error: noop }
  : console
)

const hasOwnProperty = Object.prototype.hasOwnProperty

const readOnlyTraps = {
  construct(target: any, args: any[]): any {
    return readOnly(new target(...args))
  },
  get(target: any, prop: any, receiver: any): any {
    const val = Reflect.get(target, prop, receiver)
    if (prop !== 'constructor' && isFunction(val)) {
      return readOnly((...args: any[]) => readOnly(val.apply(target, args)))
    }
    return readOnly(val)
  },
  set(target: any, prop: any, val: any) {
    throw new Error(`Invalid operation: Setting '${prop}' to read only object`)
  },
}

export const readOnly = <T>(target: T, traps: { [k: string]: Function } = {}): T => {
  if (isPrimitive(target) || isReadOnly(target)) {
    return target
  } else {
    Object.defineProperty(target as any, readOnlySymbol, {
      value: true,
      writable: false,
      enumerable: false,
    })
    return new Proxy(target, { ...readOnlyTraps, ...traps })
  }
}

export type DeepClone<T> = (
  T extends Function ? never :
  T extends (number | string | boolean | symbol | null | undefined | Date) ? T :
  T extends { [prop: string]: any, toJSON(...args: any[]): infer R } ? R :
  T extends Promise<infer R> ? Promise<DeepClone<R>> :
  { [P in keyof T]: DeepClone<T[P]> }
)

const MAX_DEPTH = 100
export const deepClone = <T extends any, R extends DeepClone<T>>(o: T, maxDepth: number = MAX_DEPTH): R => {
  if (maxDepth < 0) return void 0 as R

  // if not array or object or is null return self
  if (isFunction(o)) return void 0 as R
  if (!isObject(o)) return o as unknown as R

  // date
  if ((o as any) instanceof Date) {
    return new Date((o as any).getTime()) as R
  }

  // toJSON
  if (isFunction((o as any).toJSON)) {
    o = (o as any).toJSON()
  }

  // promise
  if (isThenable(o)) {
    const nextMaxDepth = maxDepth - 1
    return (o as any).then((o: any) => deepClone(o, nextMaxDepth))
  }

  // array
  if (isArray(o)) {
    let len = (o as any).length
    let newO = []
    const nextMaxDepth = maxDepth - 1
    for (let i = 0; i < len; i++) {
      newO[i] = deepClone(o[i], nextMaxDepth)
    }
    return newO as R
  }

  // object
  let newO: any = {}
  for (let propName in o) {
    const nextMaxDepth = maxDepth - 1
    if (hasOwnProperty.call(o, propName)) {
      newO[propName] = deepClone(o[propName], nextMaxDepth)
    }
  }
  return newO as R
}
