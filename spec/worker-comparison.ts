// @ts-nocheck
import { createJailedFunction } from '../src'
import * as fs from 'fs'

interface BenchmarkResult {
  name: string
  iterations: number
  totalMs: number
  avgMs: number
  minMs: number
  maxMs: number
  opsPerSec: number
}

async function benchmark(
  name: string,
  fn: () => Promise<any>,
  iterations: number
): Promise<BenchmarkResult> {
  const times: number[] = []

  // Warmup
  for (let i = 0; i < Math.min(3, iterations); i++) {
    await fn()
  }

  // Actual benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fn()
    times.push(performance.now() - start)
  }

  const total = times.reduce((a, b) => a + b, 0)
  return {
    name,
    iterations,
    totalMs: total,
    avgMs: total / iterations,
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
    opsPerSec: 1000 / (total / iterations)
  }
}

function formatResult(result: BenchmarkResult): string {
  return `${result.name.padEnd(50)} | avg: ${result.avgMs.toFixed(3).padStart(8)}ms | min: ${result.minMs.toFixed(3).padStart(8)}ms | max: ${result.maxMs.toFixed(3).padStart(8)}ms | ${result.opsPerSec.toFixed(1).padStart(8)} ops/s`
}

async function main() {
  console.log('='.repeat(120))
  console.log('JAILED-FUNCTION PERFORMANCE BENCHMARKS')
  console.log('='.repeat(120))
  console.log()

  // Test 1: Basic Operations
  console.log('## BASIC OPERATIONS (warm execution)')
  console.log('-'.repeat(120))

  const basicTests = {
    'Simple arithmetic': {
      code: `async (a, b) => a + b`,
      args: [2, 3]
    },
    'Small loop (100 iterations)': {
      code: `async (n) => { let sum = 0; for (let i = 0; i < n; i++) sum += i; return sum; }`,
      args: [100]
    },
    'Medium loop (10,000 iterations)': {
      code: `async (n) => { let sum = 0; for (let i = 0; i < n; i++) sum += i; return sum; }`,
      args: [10000]
    },
    'Array map (small)': {
      code: `async (arr) => arr.map(x => x * 2)`,
      args: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]
    },
    'Object creation': {
      code: `async () => { const obj = {}; for (let i = 0; i < 100; i++) obj['key' + i] = i; return obj; }`,
      args: []
    },
  }

  for (const [name, test] of Object.entries(basicTests)) {
    const fn = createJailedFunction({ source: test.code })
    const result = await benchmark(`[basic] ${name}`, async () => await fn(test.args), 100)
    console.log(formatResult(result))
  }

  // Test 2: Safe Array Method Performance
  console.log()
  console.log('## SAFE ARRAY METHODS (with timeout checks)')
  console.log('-'.repeat(120))

  const largeArray = Array.from({ length: 10000 }, (_, i) => i)

  const arrayMethods = {
    'Array.map (10k elements)': {
      code: `async (arr) => arr.map(x => x * 2)`,
      args: [largeArray]
    },
    'Array.filter (10k elements)': {
      code: `async (arr) => arr.filter(x => x % 2 === 0)`,
      args: [largeArray]
    },
    'Array.reduce (10k elements)': {
      code: `async (arr) => arr.reduce((a, b) => a + b, 0)`,
      args: [largeArray]
    },
    'Array.find (10k elements)': {
      code: `async (arr) => arr.find(x => x === 9999)`,
      args: [largeArray]
    },
    'Array.sort (1k elements)': {
      code: `async (arr) => [...arr].sort((a, b) => b - a)`,
      args: [Array.from({ length: 1000 }, () => Math.random())]
    },
    'Array.join (10k elements)': {
      code: `async (arr) => arr.join(',')`,
      args: [largeArray]
    },
  }

  for (const [name, test] of Object.entries(arrayMethods)) {
    const fn = createJailedFunction({ source: test.code })
    const result = await benchmark(`[array] ${name}`, async () => await fn(test.args), 50)
    console.log(formatResult(result))
  }

  // Test 3: Safe String Method Performance
  console.log()
  console.log('## SAFE STRING METHODS')
  console.log('-'.repeat(120))

  const longString = 'hello '.repeat(1000)

  const stringMethods = {
    'String.toUpperCase (6k chars)': {
      code: `async (s) => s.toUpperCase()`,
      args: [longString]
    },
    'String.toLowerCase (6k chars)': {
      code: `async (s) => s.toLowerCase()`,
      args: [longString]
    },
    'String.trim': {
      code: `async (s) => s.trim()`,
      args: ['   ' + longString + '   ']
    },
    'String.repeat (1000x)': {
      code: `async (s, n) => s.repeat(n)`,
      args: ['test', 1000]
    },
    'String.padStart': {
      code: `async (s, n) => s.padStart(n, '0')`,
      args: ['123', 1000]
    },
  }

  for (const [name, test] of Object.entries(stringMethods)) {
    const fn = createJailedFunction({ source: test.code })
    const result = await benchmark(`[string] ${name}`, async () => await fn(test.args), 50)
    console.log(formatResult(result))
  }

  // Test 4: Safe Object Method Performance
  console.log()
  console.log('## SAFE OBJECT METHODS')
  console.log('-'.repeat(120))

  const largeObject = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`key${i}`, i]))

  const objectMethods = {
    'Object.keys (1k props)': {
      code: `async (obj) => Object.keys(obj)`,
      globals: ['Object'],
      passGlobals: { Object }
    },
    'Object.values (1k props)': {
      code: `async (obj) => Object.values(obj)`,
      globals: ['Object'],
      passGlobals: { Object }
    },
    'Object.entries (1k props)': {
      code: `async (obj) => Object.entries(obj)`,
      globals: ['Object'],
      passGlobals: { Object }
    },
    'Object.assign (1k props)': {
      code: `async (obj) => Object.assign({}, obj)`,
      globals: ['Object'],
      passGlobals: { Object }
    },
  }

  for (const [name, test] of Object.entries(objectMethods)) {
    const fn = createJailedFunction({
      source: test.code,
      availableGlobals: test.globals || []
    })
    const result = await benchmark(`[object] ${name}`, async () => await fn([largeObject], test.passGlobals || {}), 50)
    console.log(formatResult(result))
  }

  // Test 5: Regex Operations (Safe vs Dangerous patterns)
  console.log()
  console.log('## REGEX OPERATIONS (worker protection)')
  console.log('-'.repeat(120))

  const testString = 'a'.repeat(100)

  const regexTests = {
    'Safe regex (small input)': {
      code: `async (s) => s.match(/a+/)`,
      args: [testString]
    },
    'Safe regex (large input)': {
      code: `async (s) => s.match(/a+/)`,
      args: ['a'.repeat(5000)]
    },
    'Dangerous regex (small input, worker protected)': {
      code: `async (s) => s.match(/(a+)+$/)`,
      args: ['aaaaaaaaa'] // Small enough to complete quickly
    },
  }

  for (const [name, test] of Object.entries(regexTests)) {
    const fn = createJailedFunction({
      source: test.code,
      enableNativeProtection: true,
      syncTimeout: 1000
    })
    const result = await benchmark(`[regex] ${name}`, async () => await fn(test.args), 50)
    console.log(formatResult(result))
  }

  // Test 6: JSON Operations
  console.log()
  console.log('## JSON OPERATIONS')
  console.log('-'.repeat(120))

  const smallJson = JSON.stringify({ a: 1, b: 2, c: [1, 2, 3] })
  const largeJson = JSON.stringify(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`key${i}`, { nested: i }])))

  const jsonTests = {
    'JSON.parse (small)': {
      code: `async (s) => JSON.parse(s)`,
      args: [smallJson],
      globals: ['JSON']
    },
    'JSON.parse (large - 1k objects)': {
      code: `async (s) => JSON.parse(s)`,
      args: [largeJson],
      globals: ['JSON']
    },
    'JSON.stringify (small)': {
      code: `async (obj) => JSON.stringify(obj)`,
      args: [{ a: 1, b: 2, c: [1, 2, 3] }],
      globals: ['JSON']
    },
  }

  for (const [name, test] of Object.entries(jsonTests)) {
    const fn = createJailedFunction({
      source: test.code,
      availableGlobals: test.globals
    })
    const result = await benchmark(`[json] ${name}`, async () => await fn(test.args, { JSON }), 50)
    console.log(formatResult(result))
  }

  // Test 7: Memory Tracking Overhead
  console.log()
  console.log('## MEMORY TRACKING OVERHEAD (proxy-based incremental tracking)')
  console.log('-'.repeat(120))

  const memoryTests = {
    'Array push (1k elements)': {
      code: `async () => { const arr = []; for (let i = 0; i < 1000; i++) arr.push(i); return arr.length; }`,
      globals: []
    },
    'Object property assignment (1k props)': {
      code: `async () => { const obj = {}; for (let i = 0; i < 1000; i++) obj['k' + i] = i; return Object.keys(obj).length; }`,
      globals: ['Object'],
      passGlobals: { Object }
    },
    'Nested object creation': {
      code: `async () => {
        const arr = [];
        for (let i = 0; i < 100; i++) {
          arr.push({ id: i, data: { value: i * 2, nested: { deep: i } } });
        }
        return arr.length;
      }`,
      globals: []
    },
  }

  for (const [name, test] of Object.entries(memoryTests)) {
    const fn = createJailedFunction({
      source: test.code,
      availableGlobals: test.globals || []
    })
    const result = await benchmark(`[memory] ${name}`, async () => await fn([], (test as any).passGlobals || {}), 50)
    console.log(formatResult(result))
  }

  // Test 8: Read-Only Proxy Overhead
  console.log()
  console.log('## READ-ONLY PROXY OVERHEAD')
  console.log('-'.repeat(120))

  const arrayTest = {
    code: `async (arr) => { let sum = 0; for (let i = 0; i < arr.length; i++) sum += arr[i].value; return sum; }`,
    args: [Array.from({ length: 1000 }, (_, i) => ({ value: i }))]
  }

  const fnWithReadOnly = createJailedFunction({
    source: arrayTest.code,
    readOnlyArguments: true,
    readOnlyResult: true
  })

  const fnNoReadOnly = createJailedFunction({
    source: arrayTest.code,
    readOnlyArguments: false,
    readOnlyResult: false
  })

  const withRO = await benchmark('[readonly] with read-only proxies', async () => await fnWithReadOnly(arrayTest.args), 50)
  const noRO = await benchmark('[readonly] without read-only proxies', async () => await fnNoReadOnly(arrayTest.args), 50)

  console.log(formatResult(withRO))
  console.log(formatResult(noRO))
  console.log(`  → Read-only overhead: ${((withRO.avgMs / noRO.avgMs - 1) * 100).toFixed(1)}%`)

  // Test 9: Configurable Chunk Sizes
  console.log()
  console.log('## CONFIGURABLE CHUNK SIZES (performance tuning)')
  console.log('-'.repeat(120))

  const chunkTestArr = Array.from({ length: 50000 }, (_, i) => i)

  const fnDefaultChunks = createJailedFunction({
    source: `async (arr) => arr.reduce((a, b) => a + b, 0)`,
  })

  const fnLargerChunks = createJailedFunction({
    source: `async (arr) => arr.reduce((a, b) => a + b, 0)`,
    chunkSizes: { arrayIteration: 10000 } // Larger chunks = fewer timeout checks
  })

  const fnSmallerChunks = createJailedFunction({
    source: `async (arr) => arr.reduce((a, b) => a + b, 0)`,
    chunkSizes: { arrayIteration: 1000 } // Smaller chunks = more responsive to timeout
  })

  const defaultChunks = await benchmark('[chunks] default (5000)', async () => await fnDefaultChunks([chunkTestArr]), 20)
  const largerChunks = await benchmark('[chunks] larger (10000)', async () => await fnLargerChunks([chunkTestArr]), 20)
  const smallerChunks = await benchmark('[chunks] smaller (1000)', async () => await fnSmallerChunks([chunkTestArr]), 20)

  console.log(formatResult(defaultChunks))
  console.log(formatResult(largerChunks))
  console.log(formatResult(smallerChunks))

  // Test 10: Mutation Threshold Impact
  console.log()
  console.log('## MUTATION THRESHOLD IMPACT (memory tracking frequency)')
  console.log('-'.repeat(120))

  const mutationTest = {
    code: `async () => {
      const arr = [];
      for (let i = 0; i < 10000; i++) {
        arr.push({ id: i, value: 'test' + i });
      }
      return arr.length;
    }`
  }

  const fnHighThreshold = createJailedFunction({
    source: mutationTest.code,
    mutationTreshold: 1000
  })

  const fnZeroThreshold = createJailedFunction({
    source: mutationTest.code,
    mutationTreshold: 0
  })

  const highThresholdResult = await benchmark('[mutation] threshold = 1000', async () => await fnHighThreshold(), 10)
  const zeroThresholdResult = await benchmark('[mutation] threshold = 0', async () => await fnZeroThreshold(), 10)

  console.log(formatResult(highThresholdResult))
  console.log(formatResult(zeroThresholdResult))
  console.log(`  → Zero threshold overhead: ${((zeroThresholdResult.avgMs / highThresholdResult.avgMs - 1) * 100).toFixed(1)}%`)

  // Summary
  console.log()
  console.log('='.repeat(120))
  console.log('SUMMARY & RECOMMENDATIONS')
  console.log('='.repeat(120))
  console.log(`
Key Findings:

1. SAFE METHOD WRAPPERS:
   - All Array, String, Object, and JSON methods have safe wrappers with timeout checks
   - Overhead is minimal for normal operations (< 1ms for most)
   - Large operations benefit from chunked processing

2. REGEX PROTECTION:
   - Safe regex patterns execute directly (no overhead)
   - Dangerous patterns (ReDoS-prone) are automatically detected and run in worker
   - Worker provides hard timeout isolation

3. MEMORY TRACKING:
   - Proxy-based incremental tracking adds minimal overhead
   - Memory is tracked per-property-set rather than full object traversal
   - Large object creation is properly bounded

4. CONFIGURABLE THRESHOLDS:
   - chunkSizes: Control how often timeout checks occur
     * Larger chunks = better performance, less responsive timeout
     * Smaller chunks = more overhead, more responsive timeout
   - sizeThresholds: Control when operations delegate to worker
     * Lower thresholds = more worker usage, better isolation
     * Higher thresholds = less worker usage, better performance
   - workerConfig: Control worker lifecycle
     * idleTimeout: How long worker stays alive between calls (default: 30s)
     * poolSize: Resource pool size for buffers/channels (default: 4)
   - mutationTreshold: Control when memory tracking starts for an object
     * Low/Zero: Tracks all mutations (high accuracy, high overhead)
     * High: Skips tracking for short-lived/small mutations (better performance for temporary objects)
     * Note: For large, long-lived objects, the threshold has negligible impact on total overhead

5. PERFORMANCE TUNING OPTIONS:
   - For trusted input: enableNativeProtection=false, larger chunkSizes
   - For untrusted input: enableNativeProtection=true, lower sizeThresholds
   - For latency-sensitive: larger chunkSizes, longer workerConfig.idleTimeout
   - For memory-constrained: smaller chunkSizes, shorter workerConfig.idleTimeout
`)
}

main().catch(console.error)
