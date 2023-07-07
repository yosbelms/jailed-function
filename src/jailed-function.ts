import fs from 'fs'
import { Script } from 'vm'
import { extractTypes } from './types-extractor'
import { createRuntime } from './runtime'
import { compile } from './compiler'
import { isValidIdentifier, createGetTrap, getConsole, reservedIdentifiers } from './util'
import { readOnly } from './util'
import endent from 'endent'

const defaultTimeout = 1 * 1000 * 60 // 1min
const defaultSyncTimeout = 100 // 100ms
const defaultMemoryLimit = 500 * 1024 * 1024 // 5Mb
const baseLanguageSubset = '()=>{};async()=>{};'
const languageSubset = fs.readFileSync(__dirname + '/javascript-subset.txt', 'utf-8')
const allowedNodeTypes = extractTypes(baseLanguageSubset + languageSubset)
const reservedIdentifiersValues = Object.values(reservedIdentifiers)

interface JailedFunctionConfig {
  globalNames: string[]
  timeout: number
  syncTimeout: number
  memoryLimit: number
  source: string
  filename: string
  readOnlyResult: boolean
  readOnlyGlobals: boolean
  readOnlyArguments: boolean
}

export interface JailedFunction {
  (args?: any[], globals?: { [k: string]: any }): any
  source: string
}

const readOnlyNatives = {
  console: readOnly(getConsole(), createGetTrap([
    'log',
    'error',
    'warn',
  ])),

  Object: readOnly(Object, createGetTrap([
    'keys',
    'values',
    'hasOwnProperty',
    'fromEntries',
    'assign',
    'create',
  ])),

  Promise: readOnly(Promise, createGetTrap([
    'all',
    'race',
    'resolve',
    'reject',
    'allSettled',
  ])),

  Date: readOnly(Date, createGetTrap([
    'now',
    'parse',
    'UTC',
  ])),

  Array: readOnly(Array, createGetTrap([
    'isArray',
    'from',
    'of',
  ])),

  Number: readOnly(Number, createGetTrap([
    'isFinite',
    'isInteger',
    'isNaN',
    'isSafeInteger',
    'parseFloat',
    'parseInt',
    'MAX_VALUE',
    'MIN_VALUE',
    'NaN',
    'NEGATIVE_INFINITY',
    'POSITIVE_INFINITY',
    'MAX_SAFE_INTEGER',
    'MIN_SAFE_INTEGER',
    'EPSILON',
  ])),

  String: readOnly(String, createGetTrap([
    'fromCharCode',
    'fromCodePoint',
    'raw',
  ])),

  // errors
  Error: readOnly(Error, createGetTrap([])),
  EvalError: readOnly(EvalError, createGetTrap([])),
  RangeError: readOnly(RangeError, createGetTrap([])),
  ReferenceError: readOnly(ReferenceError, createGetTrap([])),
  SyntaxError: readOnly(SyntaxError, createGetTrap([])),
  TypeError: readOnly(TypeError, createGetTrap([])),
  URIError: readOnly(URIError, createGetTrap([])),
}

const readOnlyNativesNames = Object.keys(readOnlyNatives)

export const createJailedFunction = (config: Partial<JailedFunctionConfig> = {}): JailedFunction => {
  const {
    timeout = defaultTimeout,
    syncTimeout = defaultSyncTimeout,
    memoryLimit = defaultMemoryLimit,
    source = '',
    filename = 'jailed-function:file',
    readOnlyResult = true,
    globalNames = [],
    readOnlyGlobals = true,
    readOnlyArguments = true,
  } = config

  const globalNamesSet = Array.from(new Set([...readOnlyNativesNames, ...globalNames]))
  globalNamesSet.forEach((name) => {
    if (!isValidIdentifier(name)) {
      throw new Error(`Invalid identifier '${name}'`)
    }
    if (reservedIdentifiersValues.indexOf(name) !== -1) {
      throw new Error(`Reserved identifier '${name}'`)
    }
  })

  const { code = '' } = compile(source, allowedNodeTypes, globalNamesSet)
  const resetContext = endent`const { ${globalNamesSet.join(', ')} } = ${reservedIdentifiers.globals}`;

  const transformedCode =
    `"use strict"; exports.default = (${reservedIdentifiers.globals}, ${reservedIdentifiers.runtime}) => { ${resetContext}
${`return ${code}`}
}`

  const script = new Script(transformedCode, {
    filename,
  })

  const vmCtx = {
    exports: Object.create(null),
  }

  // evaluate js code
  script.runInNewContext(vmCtx, {
    displayErrors: true,
    breakOnSigint: true,
  })

  // get the exported function, and create the wrapper
  const fn = vmCtx.exports.default
  const jailedFunction: JailedFunction = (
    args: any[] = [],
    globals: { [k: string]: any } = {},
  ) => {
    // make globals read-only
    const importedGlobals: typeof globals = { ...readOnlyNatives }
    const globalsKeys = Object.getOwnPropertyNames(globals || {})
    for (let i = 0; i < globalsKeys.length; i++) {
      let key = globalsKeys[i]
      if (!globalNamesSet.includes(key)) {
        throw new Error(`Global variable '${key}' not declared in 'globalNames'`)
      }
      importedGlobals[key] = readOnlyGlobals ? readOnly(globals[key]) : globals[key]
    }

    // make arguments read-only
    let importedArgs: typeof args = []
    for (let i = 0; i < args.length; i++) {
      importedArgs[i] = readOnlyArguments ? readOnly(args[i]) : args[i]
    }

    const runtime = createRuntime({
      timeout,
      syncTimeout,
      memoryLimit,
    })

    // execute function
    const result = (fn
      .call(null, importedGlobals, runtime)
      .apply(null, importedArgs)
    )

    // deep-clone results
    return readOnlyResult ? readOnly(result) : result
  }

  jailedFunction.source = transformedCode
  return jailedFunction
}
