# Jailed Function

Jailed Function is a Node.js library that safely runs untrusted code. It can be used in cloud services or low-code platforms that need to execute user-provided JavaScript.

## Table of Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Usage](#usage)
- [Security](#security)
- [High-Risk Method Protection](#high-risk-method-protection)
- [Globals](#globals)
- [Performance](#performance)
- [Util](#util)
- [Development](#development)
- [License](#license)

## Features

- **Secure by default:** Protects against common attacks using code constraints, sandboxing, and injected runtime checks.
- **Run untrusted JavaScript securely:** The jailed code runs in the same event loop but can't access your data or resources.
- **Set execution time limits:** Prevents DoS attacks and runaway scripts.
- **Set memory allocation limits:** Prevents memory leaks and excessive memory usage.
- **ReDoS protection:** Dangerous regex patterns are detected and executed in isolated worker threads with timeout protection.

## How it works

1.  **Compile-time restrictions**: The source code is validated against a secure [subset of JavaScript](src/javascript-subset.txt), then transpiled to inject runtime checks and limit global variable access.
2.  **Sandboxing**: The secured code runs in an isolated `vm` context.
3.  **Immutability**: Globals, arguments, and return values are made read-only using Proxies to prevent mutations.
4.  **Worker thread isolation**: Dangerous regex operations that can block the event loop are executed in worker threads with timeout protection.

## Architecture

The library has three main components:

- **Compiler:** Validates the source code against a strict feature whitelist and then transpiles it. During transpilation, it injects runtime checks for memory, execution time, and property access.
- **Runtime:** Executes the compiled code in an isolated `vm` context, providing the functions that the injected checks call into to manage resources and security.
- **Worker:** Executes dangerous regex operations in worker threads with `Atomics.wait` for synchronous timeout protection.

## Usage

### `createJailedFunction(options)`

Creates a jailed function that can be executed safely.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `source` | string | `''` | The `async` function source code |
| `availableGlobals` | string[] | `[]` | Allowed global variable names inside the jailed function |
| `timeout` | number | `60000` | Max execution time in ms (1 minute) |
| `syncTimeout` | number | `100` | Max synchronous execution time between awaits in ms |
| `enableNativeProtection` | boolean | `true` | Enable worker thread protection for dangerous regex patterns. Set to `false` to disable |
| `memoryLimit` | number | `524288000` | Max memory allocation in bytes (500 MB) |
| `filename` | string | `'jailed-function:file'` | Filename for stack traces |
| `readOnlyResult` | boolean | `true` | Make the return value read-only |
| `readOnlyGlobals` | boolean | `true` | Make globals read-only |
| `readOnlyArguments` | boolean | `true` | Make arguments read-only |

#### Basic usage

```js
const jailedFunc = createJailedFunction({
  source: `async (num1, num2) => {
    return num1 + num2
  }`
})

await jailedFunc([2, 3]) // returns 5
```

#### Injecting global variables

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

#### Disabling high-risk protection for performance

```js
// When you control all inputs and need maximum performance
const trustedFunc = createJailedFunction({
  source: `async (str) => str.match(/pattern/)`,
  enableNativeProtection: false  // Disable worker thread protection
})
```

## Security

Jailed Function provides a secure environment for untrusted JavaScript.

- **Code restrictions:** The compiler enforces a strict whitelist of language features and globals. This prevents the use of potentially malicious features, such as dynamic code execution (`eval`, `Function`) or module loading (`require`).
- **Sandboxing:** Node.js `vm` creates an isolated context, preventing access to the file system, network, and other sensitive resources.
- **Runtime checks:** Injected code monitors execution time and memory usage, terminating the function to prevent DoS attacks or memory leaks.
- **Immutability:** Globals, arguments, and return values are made read-only to protect your data.
- **ReDoS protection:** Dangerous regex patterns are detected and run in worker threads with timeout protection.

## High-Risk Method Protection

Regex operations can block the event loop with catastrophic backtracking (ReDoS attacks). When dangerous patterns are detected, these operations are automatically executed in worker threads with `Atomics.wait` for true synchronous timeout protection.

### Worker-Protected Methods (Regex)

| Category | Methods |
|----------|---------|
| String (regex) | `match`, `replace`, `search`, `split` |
| RegExp | `exec`, `test` |

Worker protection triggers when:
- A regex pattern is detected as potentially dangerous (nested quantifiers, backreferences, etc.)
- The input string exceeds the size threshold (default: 1000 chars)

### Safe Wrappers (Timeout Checks)

Other operations use chunked processing with periodic timeout checks:

| Category | Methods |
|----------|---------|
| Object | `keys`, `values`, `assign`, `fromEntries` |
| Array | `from`, `fill`, `sort`, `reverse`, `flat`, `flatMap`, `join`, `concat`, `indexOf`, `find`, `filter`, `map`, `reduce`, etc. |
| String | `repeat`, `normalize`, `padStart`, `padEnd`, `toLowerCase`, `toUpperCase`, `trim`, `includes`, etc. |
| Encoding | `encodeURIComponent`, `encodeURI` |
| JSON | `parse`, `stringify` |

### Example: ReDoS Protection

```js
const fn = createJailedFunction({
  source: `async (input, regex) => input.match(regex)`,
  syncTimeout: 100  // 100ms timeout for synchronous operations
})

// This evil regex would normally hang for hours
const evilRegex = /^(a+)+$/
const evilInput = 'a'.repeat(25) + 'X'

await fn([evilInput, evilRegex])
// Throws: "Timeout error" after 100ms instead of hanging
```

### Performance Considerations

Worker thread isolation uses a persistent worker pool, adding minimal overhead (~0.006ms) per protected method call after the initial cold start:

| Protection | Latency | Throughput |
|------------|---------|------------|
| Enabled (`enableNativeProtection: true`) | ~0.006ms | ~160,000+ ops/s |
| Disabled (`enableNativeProtection: false`) | ~0.003ms | ~300,000+ ops/s |

**When to disable protection (`enableNativeProtection: false`):**
- You control all regex patterns (no user input)
- Performance is critical (extreme throughput needed)
- Security risk is acceptable for your use case

## Globals

Built-in globals available in jailed functions:

| Global | Methods/Properties |
|--------|-------------------|
| `console` | `log`, `error`, `warn` *(muted in production)* |
| `Object` | `keys`, `values`, `hasOwnProperty`, `fromEntries`, `assign`, `create` |
| `Promise` | `all`, `race`, `resolve`, `reject`, `allSettled` |
| `Date` | `now`, `parse`, `UTC` |
| `Array` | `isArray`, `from`, `of` |
| `Number` | `isFinite`, `isInteger`, `isNaN`, `isSafeInteger`, `parseFloat`, `parseInt`, `MAX_VALUE`, `MIN_VALUE`, `NaN`, `NEGATIVE_INFINITY`, `POSITIVE_INFINITY`, `MAX_SAFE_INTEGER`, `MIN_SAFE_INTEGER`, `EPSILON` |
| `String` | `fromCharCode`, `fromCodePoint`, `raw` |
| `encodeURIComponent` | *(function)* |
| `encodeURI` | *(function)* |
| `Error` | *(constructor)* |
| `TypeError` | *(constructor)* |
| `RangeError` | *(constructor)* |
| `ReferenceError` | *(constructor)* |
| `SyntaxError` | *(constructor)* |
| `EvalError` | *(constructor)* |
| `URIError` | *(constructor)* |

## Performance

### Jailed Function vs Worker Threads

| Scenario | Jailed Function | Worker Threads |
|----------|-----------------|----------------|
| Cold start | ~1.5ms | ~15ms |
| Warm execution | ~0.004ms | ~15ms (must spawn each time) |
| Memory overhead | Low (shared V8) | High (~5-10MB per worker) |

### Recommendation

- **Use jailed-function for:** Frequent, short executions (<100ms)
- **Use worker threads for:** Infrequent, long-running tasks or when true process isolation is critical

Performance tests are in [`spec/worker-comparison.ts`](spec/worker-comparison.ts).

## Util

### `readOnly(target, traps)`

Prevents object modification by wrapping in a Proxy.

### `createGetTrap(propNames)`

Creates a Proxy `get` trap to allow access only to specified properties.

#### Example: Restrict Math to only `max`

```js
const max = createJailedFunction({
  availableGlobals: ['Math'],
  source: `async (a, b) => Math.max(a, b)`
})

await max([1, 2], { Math: readOnly(Math, createGetTrap(['max'])) })
```

## Development

### Requirements

- Node.js 16+ (for `SharedArrayBuffer` and `worker_threads` support)

### Build

```bash
npm run build
```

### Test

```bash
npm run test
```

### Benchmark

```bash
npx ts-node spec/worker-comparison.ts
```

## License

(c) 2023-present Yosbel Marín, MIT License
