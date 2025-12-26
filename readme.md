# Jailed Function

Jailed Function is a Node.js library that safely runs untrusted code. It can be used in cloud services or low-code platforms that need to execute user-provided JavaScript.

## Table of Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Usage](#usage)
- [Security](#security)
- [Globals](#globals)
- [Benchmarks](#benchmarks)
- [Util](#util)
- [Development](#development)
- [License](#license)

## Features

- **Secure by default:** Protects against common attacks using code constraints, sandboxing, and injected runtime checks.
- **Run untrusted JavaScript securely:** The jailed code runs in the same event loop but can't access your data or resources.
- **Set execution time limits:** Prevents DoS attacks and runaway scripts.
- **Set memory allocation limits:** Prevents memory leaks and excessive memory usage.

## How it works

1.  **Compile-time restrictions**: The source code is validated against a secure [subset of JavaScript](src/javascript-subset.txt), then transpiled to inject runtime checks and limit global variable access.
2.  **Sandboxing**: The secured code runs in an isolated `vm` context.
3.  **Immutability**: Globals, arguments, and return values are made read-only using Proxies to prevent mutations.

## Architecture

The library has two main components:

- **Compiler:** Validates the source code against a strict feature whitelist and then transpiles it. During transpilation, it injects runtime checks for memory, execution time, and property access.
- **Runtime:** Executes the compiled code in an isolated `vm` context, providing the functions that the injected checks call into to manage resources and security.

## Usage

### `createJailedFunction(options)`

Creates a jailed function that can be executed safely.

#### Options

- `source` (string): The `async` function source code.
- `availableGlobals` (string[]): Allowed global variable names inside the jailed function.
- `timeout` (number): Max execution time in ms. Default: `60000` (1 minute).
- `syncTimeout` (number): Max synchronous execution time in ms. Default: `100`.
- `memoryLimit` (number): Max memory allocation in bytes. Default: `524288000` (500 MB).
- `filename` (string): Filename for stack traces. Default: `jailed-function:file`.
- `readOnlyResult` (boolean): Make the return value read-only. Default: `true`.
- `readOnlyGlobals` (boolean): Make globals read-only. Default: `true`.
- `readOnlyArguments` (boolean): Make arguments read-only. Default: `true`.

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
const findUserById = createJailedFunction({
  availableGlobals: ['userService'],
  source: `async (id) => {
    return userService.byId(id)
  }`
})

// provide global variables during execution
await findUserById([1], { userService })
```

## Security

Jailed Function provides a secure environment for untrusted JavaScript.

- **Code restrictions:** The compiler enforces a strict whitelist of language features and globals. This prevents the use of potentially malicious features, such as dynamic code execution (`eval`, `Function`) or module loading (`require`).
- **Sandboxing:** Node.js `vm` creates an isolated context, preventing access to the file system, network, and other sensitive resources.
- **Runtime checks:** Injected code monitors execution time and memory usage, terminating the function to prevent DoS attacks or memory leaks.
- **Immutability:** Globals, arguments, and return values are made read-only to protect your data.

## Globals

Provides several built-in globals:

- `console.[log, error, warn]` (*muted in production*)
- `Object.[keys, values, hasOwnProperty, fromEntries, assign, create]`
- `Promise.[all, race, resolve, reject, allSettled]`
- `Date.[now, parse, UTC]`
- `Array.[isArray, from, of]`
- `Number.[isFinite, isInteger, isNaN, isSafeInteger, parseFloat, parseInt, MAX_VALUE, MIN_VALUE, NaN, NEGATIVE_INFINITY, POSITIVE_INFINITY, MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, EPSILON]`
- `String.[fromCharCode, fromCodePoint, raw]`

## Benchmarks

Jailed Function is designed for performance. See our benchmarks against other popular libraries.

Performance tests are in [`spec/perf.ts`](spec/perf.ts).

## Util

- `readOnly(target, traps)`: Prevents object modification.
- `createGetTrap(propNames)`: Creates a Proxy `get` trap to allow access only to specified properties.

Inject `Math` object allowing only `max` property access.
```js
const max = createJailedFunction({
  availableGlobals: ['Math'],
  source: `async (a, b) => Math.max(a, b)`
})

// provide Math global during execution
await max([1, 2], { Math: readOnly(Math, createGetTrap(['max'])) })
```

## Development

### Build

To build the library, run the following command:

```bash
npm run build
```

### Test

To run the tests, run the following command:

```bash
npm run test
```

## License

(c) 2023-present Yosbel Marín, MIT License
