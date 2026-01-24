// https://www.mattzeunert.com/2016/07/24/javascript-array-object-sizes.html

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
      } else {
        throw new Error(`Invalid operation: Accessing not allowed '${prop}' property`)
      }
    }
  }
}

const readOnlySymbol = Symbol('read-only')

export const reservedIdentifiers = {
  globals: '$$g',
  runtime: '$$r',
}

export const isReadOnly = (obj: any) => !isPrimitive(obj) && obj[readOnlySymbol]
export const noop = () => { }

export const isObject = (obj: any) => typeof obj === 'object' && obj !== null
export const isFunction = (fn: any) => typeof fn === 'function'
export const isPrimitive = (v: any) => v == null || (!isFunction(v) && !isObject(v))
export const isThenable = (v: any) => v && isFunction(v.then)
export const isProduction = () => {
  const { NODE_ENV } = process.env
  return NODE_ENV === 'production'
}
export const getConsole = () => (isProduction()
  ? { log: noop, warn: noop, error: noop }
  : console
)

const readOnlyTraps = {
  construct(target: any, args: any[]): any {
    const instance = new target(...args)
    // console.log(instance.stack)
    return readOnly(instance)
    // return instance
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



// Sanitizes error stack traces to prevent leaking internal implementation paths.
const sanitizeStack = (stack: string | undefined, filename: string): string => {
  if (!stack) return ''

  const lines = stack.split('\n')
  const sanitized = lines.filter(line => {
    // Keep only lines that don't expose internal implementation
    return (
      !line.includes('node_modules') &&
      !line.includes('jailed-function/src/') &&
      !line.includes('/src/runtime.ts') &&
      !line.includes('/src/jailed-function.ts') &&
      !line.includes('/src/compiler.ts')
    )
  }).map(line => {
    // Normalize internal references to the configured filename
    return line.replace(/jailed-function:file/g, filename)
  })

  return sanitized.join('\n')
}

// Sanitizes an error by removing internal stack trace information.
export const sanitizeError = <T extends Error>(error: T, filename: string): T => {
  error.stack = sanitizeStack(error.stack, filename)
  return error
}
