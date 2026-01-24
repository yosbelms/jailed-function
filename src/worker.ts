import { MessageChannel, receiveMessageOnPort, Worker } from 'worker_threads'
import { TimeoutError } from './error'

export interface WorkerConfig {
  idleTimeout: number
  poolSize: number
}

const defaultConfig: WorkerConfig = {
  idleTimeout: 30000,
  poolSize: 4,
}

const workerCode = `
const { parentPort } = require('worker_threads');
const vm = require('vm');

const globals = { Object, Array, String, Number, JSON, Math, Date, encodeURIComponent, encodeURI, decodeURIComponent, decodeURI };

function deserialize(s) {
  if (s.type === 'regexp') return new RegExp(s.value.source, s.value.flags);
  if (s.type === 'global') return globals[s.value];
  return s.value;
}

const context = vm.createContext({
  Object, Array, String, Number, Boolean, JSON, Math, Date, RegExp,
  encodeURIComponent, encodeURI, decodeURIComponent, decodeURI,
  parseInt, parseFloat, isNaN, isFinite,
  Error, TypeError, RangeError, SyntaxError
});

parentPort.on('message', (message) => {
  const { serializedObject, methodName, serializedArgs, sharedBuffer, port } = message;
  const sharedArray = new Int32Array(sharedBuffer);

  try {
    const obj = deserialize(serializedObject);
    const args = serializedArgs.map(deserialize);

    context.__obj__ = obj;
    context.__args__ = args;
    context.__methodName__ = methodName;

    const result = vm.runInContext(
      '__methodName__ === null ? __obj__(...__args__) : __obj__[__methodName__](...__args__)',
      context
    );

    delete context.__obj__;
    delete context.__args__;
    delete context.__methodName__;

    port.postMessage({ success: true, result });
  } catch (err) {
    const errorType = err.constructor.name || 'Error';
    port.postMessage({ success: false, error: err.message, errorType });
  } finally {
    Atomics.store(sharedArray, 0, 1);
    Atomics.notify(sharedArray, 0);
  }
});
`

let activeWorker: Worker | null = null
let idleTimer: NodeJS.Timeout | null = null
let currentConfig = { ...defaultConfig }

const sharedBufferPool: SharedArrayBuffer[] = []
const messageChannelPool: MessageChannel[] = []

const acquireSharedBuffer = (): SharedArrayBuffer => {
  return sharedBufferPool.pop() || new SharedArrayBuffer(4)
}

const releaseSharedBuffer = (buffer: SharedArrayBuffer): void => {
  if (sharedBufferPool.length < currentConfig.poolSize) {
    sharedBufferPool.push(buffer)
  }
}

const acquireMessageChannel = (): MessageChannel => {
  return messageChannelPool.pop() || new MessageChannel()
}

export const configureWorker = (config: Partial<WorkerConfig>): void => {
  currentConfig = { ...currentConfig, ...config }
}

export const terminateWorker = (): void => {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (activeWorker) {
    activeWorker.terminate()
    activeWorker = null
  }
}

const getWorker = (): Worker => {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }

  if (!activeWorker) {
    activeWorker = new Worker(workerCode, { eval: true })
    activeWorker.unref()

    activeWorker.on('error', () => {
      terminateWorker()
    })

    activeWorker.on('exit', () => {
      if (activeWorker) terminateWorker()
    })
  }

  return activeWorker
}

const scheduleIdleTermination = (): void => {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(terminateWorker, currentConfig.idleTimeout)
  idleTimer.unref()
}

type Serialized = { type: string; value: any }

const isRegExpLike = (value: any): boolean => {
  if (!value || typeof value !== 'object') return false
  if (value instanceof RegExp) return true
  try {
    if (Object.prototype.toString.call(value) === '[object RegExp]') return true
  } catch {}
  try {
    const str = String(value)
    if (/^\/.*\/[gimsuy]*$/.test(str)) return true
  } catch {}
  return false
}

const getRegExpData = (value: any): { source: string; flags: string } | null => {
  if (!isRegExpLike(value)) return null

  try {
    if (typeof value.source === 'string' && typeof value.flags === 'string') {
      return { source: value.source, flags: value.flags }
    }
  } catch {}

  try {
    const str = String(value)
    const lastSlash = str.lastIndexOf('/')
    if (lastSlash > 0 && str[0] === '/') {
      const flags = str.slice(lastSlash + 1)
      if (/^[gimsuy]*$/.test(flags)) {
        return { source: str.slice(1, lastSlash), flags }
      }
    }
  } catch {}

  return null
}

const isProtectedProperty = (prop: string): boolean => {
  const protected_ = ['__proto__', 'constructor', 'prototype']
  return protected_.includes(prop) || prop.startsWith('__')
}

const safeClone = (value: any, depth = 0, maxDepth = 100): any => {
  if (depth > maxDepth) {
    throw new Error('Object too deeply nested')
  }
  if (value === null || value === undefined) return value
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(v => safeClone(v, depth + 1, maxDepth))
  }
  if (typeof value === 'object') {
    const result: any = {}
    for (const key of Object.keys(value)) {
      if (!isProtectedProperty(key)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor && 'value' in descriptor) {
          result[key] = safeClone(descriptor.value, depth + 1, maxDepth)
        }
      }
    }
    return result
  }
  return undefined
}

const serialize = (value: any): Serialized => {
  const regexData = getRegExpData(value)
  if (regexData) {
    return { type: 'regexp', value: regexData }
  }
  const globals: Record<string, any> = {
    Object, Array, String, Number, JSON, Math, Date,
    encodeURIComponent, encodeURI, decodeURIComponent, decodeURI
  }
  for (const name in globals) {
    if (value === globals[name]) return { type: 'global', value: name }
  }
  if (typeof value === 'function') {
    throw new Error('Cannot serialize arbitrary functions')
  }
  return { type: 'value', value: safeClone(value) }
}

export const execInWorker = (
  object: RegExp | string | any[] | object,
  methodName: string | null,
  args: any[],
  timeout: number,
): any => {
  const sharedBuffer = acquireSharedBuffer()
  const sharedArray = new Int32Array(sharedBuffer)
  const { port1, port2 } = acquireMessageChannel()

  const worker = getWorker()
  Atomics.store(sharedArray, 0, 0)

  try {
    worker.postMessage({
      serializedObject: serialize(object),
      methodName,
      serializedArgs: args.map(serialize),
      sharedBuffer,
      port: port2
    }, [port2])
  } catch (err) {
    releaseSharedBuffer(sharedBuffer)
    terminateWorker()
    throw err
  }

  const waitResult = Atomics.wait(sharedArray, 0, 0, timeout)

  if (waitResult === 'timed-out') {
    releaseSharedBuffer(sharedBuffer)
    terminateWorker()
    throw new TimeoutError('Timeout error')
  }

  const msg = receiveMessageOnPort(port1)
  releaseSharedBuffer(sharedBuffer)

  if (!msg) {
    terminateWorker()
    throw new Error('No response from worker')
  }

  scheduleIdleTermination()

  const { success, result, error, errorType } = msg.message
  if (!success) {
    const errorConstructors: Record<string, new (msg: string) => Error> = {
      RangeError, TypeError, SyntaxError, ReferenceError, URIError, EvalError
    }
    const ErrorClass = errorConstructors[errorType] || Error
    throw new ErrorClass(error)
  }

  return result
}
