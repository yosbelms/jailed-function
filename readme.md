# Jailed Function

Jailed Function is a Node.js library that safely runs untrusted code entered by users. It can be used in cloud services or low-code platforms that need to execute user-provided JavaScript.

## Features

- **Immune to all known attacks:** Jailed Function uses a variety of security mechanisms to prevent attacks, including code contrains, sandboxing, and runtime watchdog.
- **Securely run JavaScript code:** Jailed Function allows you to run untrusted JavaScript code in a safe environment. Your code and the jailed code will share the same event loop, but the jailed code will be unable to access your data or resources.
- **Customizable function execution time limit:** You can set a limit on the amount of time that a jailed function can execute. This helps to prevent DoS attacks and other malicious behavior.
- **Customizable function memory allocation:** You can set a limit on the amount of memory that a jailed function can allocate. This helps to prevent memory leaks and other resource-intensive behavior.

## How does it work

1. The source code is transpiled to a secure source code by allowing only a [JavaScript subset](src/javascript-subset.txt) and limiting global variable access at compile time. Additionaly the new code contains runtime memory and execution time checks to limit resource usage on each run.
2. Run secured source code in an isolated context using Node.js VM.
2. All imported globals and arguments passed to jailed functions are made read-only using Proxies, thus preventing mutations.
3. Return deep clones of jailed functions results before exiting the sandbox scope.

## Usage

Basic usage:
```js
const jailedFunc = createJailedFunction({
  source: `async (num1, num2) => {
    return num1 + num2
  }`
})

await jailedFunc([2, 3]) // returns 5
```

Injecting global variables into the execution context:
```js
const finUserById = createJailedFunction({
  // declaring global vars
  globalNames: ['userService']
  source: `async (id) => {
    return userService.byId(id)
  }`
})

// execute the function providing global vars
await finUserById([1], { userService })
```

## Options

- `globalNames` List of global variable names allowed to use inside the jailed function.
- `timeout (ms)` Maximum execution time for the function. Default 1min.
- `syncTimeout (ms)` Maximum execution time for the function running synchronous code. Default 100ms.
- `memoryLimit (bytes)` Maximum amount of memory that the function is allowed to allocate.
- `source` The function source code. This function must be `async`.
- `filename` The filename to display in the stack trace.
- `readOnlyResult` Whether to make read-only jailed function return value. Default `true`.
- `readOnlyGlobals` Whether to make read-only jailed function globals. Default `true`.
- `readOnlyArguments` Whether to make read-only jailed function arguments. Default `true`.

## Globals

Jailed Function provides access to several convenient built-in globals.

- `console [log, error, warn]` *muted in production*
- `Object [keys, values, hasOwnProperty, fromEntries, assign, create]`
- `Promise [all, race, resolve, reject, allSettled]`
- `Date [now, parse, UTC]`
- `Array [isArray, from, of]`
- `Number [isFinite, isInteger, isNaN, isSafeInteger, parseFloat, parseInt, MAX_VALUE, MIN_VALUE, NaN, NEGATIVE_INFINITY, POSITIVE_INFINITY, MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, EPSILON]`
- `String [romCharCode, fromCodePoint, raw]`

## Util

- `readOnly(target: any, traps: {})` Prevents object modification.
- `createGetTrap(propNames: string[])` Create Proxy get traps that allows access only to the properties passed in arguments.

Inject `Math` object allowing only `max` property access. 
```js
const max = createJailedFunction({
  globalNames: ['Math']
  source: `async (a, b) => Math.max(a, b)`
})

// execute the function providing global vars
await max([1], { Math: readOnly(Math, createGetTrap(['max'])) })
```

(c) 2023-present Yosbel Marín, MIT License
