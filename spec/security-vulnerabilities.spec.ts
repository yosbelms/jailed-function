import 'source-map-support/register'
import 'jasmine'
import { createJailedFunction } from '../src'
import { TimeoutError, MemoryLimitError } from '../src/error'

/**
 * Security Vulnerability Tests
 *
 * These tests demonstrate known security issues in the current library version.
 * Tests marked with "VULNERABILITY" in the description are expected to FAIL,
 * showing that the library does NOT properly protect against these attacks.
 *
 * When a vulnerability is fixed, the corresponding test should start passing.
 */
describe('Security Vulnerabilities', () => {

  describe('Sync Timeout Bypass', () => {

    /**
     * VULNERABILITY: ReDoS (Regular Expression Denial of Service)
     *
     * The syncTimeout only checks at loop iterations and function boundaries.
     * A single regex with catastrophic backtracking can block indefinitely.
     */
    it('should timeout on ReDoS attack (catastrophic backtracking)', async () => {
      const jailedFunc = createJailedFunction({
        syncTimeout: 50,
        timeout: 100,
        source: `(input) => {
          // This regex has catastrophic backtracking: O(2^n) complexity
          const evilRegex = /^(a+)+$/
          return evilRegex.test(input)
        }`
      })

      // Input designed to cause catastrophic backtracking
      // 25 'a's followed by 'X' - causes regex engine to try 2^25 combinations
      const maliciousInput = 'a'.repeat(25) + 'X'

      const start = Date.now()
      try {
        jailedFunc([maliciousInput])
        // If we get here without timeout, the vulnerability exists
        const elapsed = Date.now() - start
        // If execution took more than the syncTimeout, it's a vulnerability
        if (elapsed > 100) {
          fail(`VULNERABILITY CONFIRMED: ReDoS bypassed syncTimeout. Took ${elapsed}ms instead of timing out at 100ms`)
        }
      } catch (e) {
        // Should throw TimeoutError if properly protected
        expect(e).toBeInstanceOf(TimeoutError)
      }
    })

    /**
     * VULNERABILITY: Large JSON parsing bypass
     *
     * JSON.parse is a single operation that can take arbitrary time
     * depending on input size, bypassing syncTimeout checks.
     */
    it('should timeout on large JSON.parse operation', async () => {
      const jailedFunc = createJailedFunction({
        syncTimeout: 50,
        timeout: 100,
        availableGlobals: ['JSON'],
        source: `(jsonStr) => {
          return JSON.parse(jsonStr)
        }`
      })

      // Create a deeply nested JSON structure
      let deepJson = '{"a":'
      for (let i = 0; i < 50000; i++) {
        deepJson += '{"a":'
      }
      deepJson += '1'
      for (let i = 0; i < 50001; i++) {
        deepJson += '}'
      }

      const start = Date.now()
      try {
        jailedFunc([deepJson], { JSON })
        const elapsed = Date.now() - start
        // If execution took more than the syncTimeout, it's a vulnerability
        if (elapsed > 100) {
          fail(`VULNERABILITY CONFIRMED: JSON.parse bypassed syncTimeout. Took ${elapsed}ms`)
        }
      } catch (e) {
        // RangeError from JSON.parse is acceptable (stack overflow)
        // TimeoutError would mean proper protection
        if (e instanceof TimeoutError) {
          // Good - properly protected
        } else if (e instanceof RangeError) {
          // Acceptable - native protection kicked in
        } else {
          throw e
        }
      }
    })

    /**
     * VULNERABILITY: String.prototype.repeat bypass
     *
     * A single call to String.repeat with large value can allocate
     * huge amounts of memory and take significant time.
     */
    it('should timeout on large string allocation via repeat', async () => {
      const jailedFunc = createJailedFunction({
        syncTimeout: 50,
        timeout: 100,
        source: `(n) => {
          // Single operation that can take arbitrary time
          return "x".repeat(n).length
        }`
      })

      const start = Date.now()
      try {
        // Try to allocate a 100MB string (smaller to avoid OOM)
        jailedFunc([100 * 1024 * 1024])
        const elapsed = Date.now() - start
        if (elapsed > 100) {
          fail(`VULNERABILITY CONFIRMED: String.repeat bypassed syncTimeout. Took ${elapsed}ms`)
        }
      } catch (e) {
        // Should throw TimeoutError if properly protected
        // RangeError is also acceptable (string too long)
        if (!(e instanceof TimeoutError) && !(e instanceof RangeError)) {
          throw e
        }
      }
    })

    /**
     * VULNERABILITY: Array sort with expensive comparator
     *
     * While the comparator has loops that get timeout-checked,
     * this demonstrates how native operations interleave with JS.
     */
    it('should timeout on expensive array sort', async () => {
      const jailedFunc = createJailedFunction({
        syncTimeout: 50,
        timeout: 100,
        availableGlobals: ['Array'],
        source: `(size) => {
          // Create array and fill it
          const arr = []
          for (let i = 0; i < size; i++) {
            arr.push(size - i)
          }
          // Sort - comparator loops are checked, but demonstrates perf impact
          arr.sort((a, b) => a - b)
          return arr[0]
        }`
      })

      const start = Date.now()
      try {
        jailedFunc([100000], { Array })
        const elapsed = Date.now() - start
        if (elapsed > 100) {
          fail(`VULNERABILITY CONFIRMED: Array sort operation took ${elapsed}ms`)
        }
      } catch (e) {
        expect(e).toBeInstanceOf(TimeoutError)
      }
    })

  })

  describe('Native Method Timeout Bypass', () => {

    /**
     * Helper to test if a native method bypasses timeout.
     * Returns true if vulnerability exists (took longer than expected without throwing).
     */
    const testTimeoutBypass = async (
      source: string,
      args: any[] = [],
      globals: Record<string, any> = {},
      availableGlobals: string[] = []
    ): Promise<{ bypassed: boolean; elapsed: number; error?: any }> => {
      const jailedFunc = createJailedFunction({
        syncTimeout: 50,
        timeout: 100,
        availableGlobals,
        source
      })


      const start = Date.now()
      try {
        // console.log(jailedFunc)
        jailedFunc(args, globals)
        const elapsed = Date.now() - start
        return { bypassed: elapsed > 100, elapsed }
      } catch (e) {
        const elapsed = Date.now() - start
        return { bypassed: false, elapsed, error: e }
      }
    }

    // ==================== REGEX METHODS ====================

    describe('Regex Methods (ReDoS)', () => {

      const evilPattern = /^(a+)+$/
      const maliciousInput = 'a'.repeat(25) + 'X'

      it('VULNERABILITY: String.match() with catastrophic backtracking', async () => {
        const result = await testTimeoutBypass(
          `(input, regex) => input.match(regex)`,
          [maliciousInput, evilPattern]
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: String.match() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

      it('VULNERABILITY: String.replace() with catastrophic backtracking', async () => {
        const result = await testTimeoutBypass(
          `(input, regex) => input.replace(regex, '')`,
          [maliciousInput, evilPattern]
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: String.replace() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

      it('VULNERABILITY: String.search() with catastrophic backtracking', async () => {
        const result = await testTimeoutBypass(
          `(input, regex) => input.search(regex)`,
          [maliciousInput, evilPattern]
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: String.search() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

      it('VULNERABILITY: String.split() with catastrophic backtracking', async () => {
        const result = await testTimeoutBypass(
          `(input, regex) => input.split(regex)`,
          [maliciousInput, evilPattern]
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: String.split() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

      it('VULNERABILITY: RegExp.exec() with catastrophic backtracking', async () => {
        const result = await testTimeoutBypass(
          `(input, regex) => regex.exec(input)`,
          [maliciousInput, evilPattern]
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: RegExp.exec() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

    })

    // ==================== STRING METHODS ====================

    describe('String Methods', () => {

      it('VULNERABILITY: String.repeat() with large count', async () => {
        const result = await testTimeoutBypass(
          `(n) => "x".repeat(n).length`,
          [50 * 1024 * 1024] // 50MB string
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: String.repeat() bypassed timeout. Took ${result.elapsed}ms`)
        }
        // RangeError is acceptable (native protection)
        if (result.error && !(result.error instanceof RangeError) && !(result.error instanceof TimeoutError)) {
          throw result.error
        }
      })

      it('VULNERABILITY: String.padStart() with large length', async () => {
        const result = await testTimeoutBypass(
          `(n) => "x".padStart(n, "y").length`,
          [50 * 1024 * 1024]
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: String.padStart() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

      it('VULNERABILITY: String.padEnd() with large length', async () => {
        const result = await testTimeoutBypass(
          `(n) => "x".padEnd(n, "y").length`,
          [50 * 1024 * 1024]
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: String.padEnd() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

      it('VULNERABILITY: String concatenation in single expression', async () => {
        // Build a function that does massive concatenation
        const result = await testTimeoutBypass(
          `(base) => base.repeat(20).split('').map(c => c.repeat(1000)).join('')`,
          ['abcdefghij']
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: String concatenation bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

    })

    // ==================== JSON METHODS ====================

    describe('JSON Methods', () => {

      it('VULNERABILITY: JSON.parse() with deeply nested object', async () => {
        // Create deeply nested JSON
        let deepJson = '{"a":'
        for (let i = 0; i < 30000; i++) {
          deepJson += '{"a":'
        }
        deepJson += '1'
        for (let i = 0; i < 30001; i++) {
          deepJson += '}'
        }

        const result = await testTimeoutBypass(
          `(json) => JSON.parse(json)`,
          [deepJson],
          { JSON },
          ['JSON']
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: JSON.parse() bypassed timeout. Took ${result.elapsed}ms`)
        }
        // RangeError is acceptable (stack overflow)
      })

      it('VULNERABILITY: JSON.stringify() with large object', async () => {
        // Create a deeply nested object that's slow to serialize
        const createNested = (depth: number): any => {
          if (depth === 0) return { data: 'x'.repeat(1000) }
          return { nested: createNested(depth - 1), data: 'x'.repeat(1000) }
        }
        const deepObj = createNested(500)

        const result = await testTimeoutBypass(
          `(obj) => JSON.stringify(obj).length`,
          [deepObj],
          { JSON },
          ['JSON']
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: JSON.stringify() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

    })

    // ==================== ARRAY METHODS ====================

    describe('Array Methods', () => {

      it('VULNERABILITY: Array.join() with large array', async () => {
        const result = await testTimeoutBypass(
          `(n) => {
            const arr = []
            for (let i = 0; i < n; i++) arr.push('x')
            return arr.join('').length
          }`,
          [1000000]
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: Array.join() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

      it('VULNERABILITY: Array.from() with large length', async () => {
        const result = await testTimeoutBypass(
          `(n) => Array.from({ length: n }).length`,
          [10000000],
          { Array },
          ['Array']
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: Array.from() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

      it('VULNERABILITY: Array.fill() with large array', async () => {
        const result = await testTimeoutBypass(
          `(n) => {
            const arr = []
            arr.length = n
            return arr.fill(0).length
          }`,
          [10000000]
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: Array.fill() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

      it('VULNERABILITY: Spread operator with large array', async () => {
        const largeArr = new Array(100000).fill(1)
        const result = await testTimeoutBypass(
          `(arr) => [...arr, ...arr, ...arr, ...arr, ...arr].length`,
          [largeArr]
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: Spread operator bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

    })

    // ==================== OBJECT METHODS ====================

    describe('Object Methods', () => {

      it('VULNERABILITY: Object.keys() with huge object', async () => {
        const hugeObj: Record<string, number> = {}
        for (let i = 0; i < 500000; i++) {
          hugeObj[`k${i}`] = i
        }

        const result = await testTimeoutBypass(
          `(obj) => Object.keys(obj).length`,
          [hugeObj],
          { Object },
          ['Object']
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: Object.keys() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

      it('VULNERABILITY: Object.values() with huge object', async () => {
        const hugeObj: Record<string, number> = {}
        for (let i = 0; i < 500000; i++) {
          hugeObj[`k${i}`] = i
        }

        const result = await testTimeoutBypass(
          `(obj) => Object.values(obj).length`,
          [hugeObj],
          { Object },
          ['Object']
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: Object.values() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

      it('VULNERABILITY: Object.entries() with huge object', async () => {
        const hugeObj: Record<string, number> = {}
        for (let i = 0; i < 500000; i++) {
          hugeObj[`k${i}`] = i
        }

        const result = await testTimeoutBypass(
          `(obj) => Object.entries(obj).length`,
          [hugeObj],
          { Object },
          ['Object']
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: Object.entries() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

    })

    // ==================== ENCODING METHODS ====================

    describe('Encoding Methods', () => {

      it('VULNERABILITY: encodeURIComponent() with large string', async () => {
        const largeString = 'é'.repeat(1000000) // Non-ASCII chars require more encoding

        const result = await testTimeoutBypass(
          `(str) => encodeURIComponent(str).length`,
          [largeString],
          { encodeURIComponent },
          ['encodeURIComponent']
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: encodeURIComponent() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

      it('VULNERABILITY: decodeURIComponent() with large string', async () => {
        const encoded = encodeURIComponent('é'.repeat(500000))

        const result = await testTimeoutBypass(
          `(str) => decodeURIComponent(str).length`,
          [encoded],
          { decodeURIComponent },
          ['decodeURIComponent']
        )
        if (result.bypassed) {
          fail(`VULNERABILITY: decodeURIComponent() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

    })

    // ==================== NUMBER METHODS ====================

    describe('Number Methods', () => {

      it('VULNERABILITY: Number.toString() with small radix', async () => {
        // Large number with small radix produces long string
        const result = await testTimeoutBypass(
          `(n) => n.toString(2).length`, // Binary representation
          [Number.MAX_SAFE_INTEGER]
        )
        // This is usually fast, but test for completeness
        if (result.bypassed) {
          fail(`VULNERABILITY: Number.toString() bypassed timeout. Took ${result.elapsed}ms`)
        }
      })

    })

  })

  describe('Prototype Pollution / Property Access', () => {

    /**
     * VULNERABILITY: __proto__ access
     *
     * The protectedProperty list uses Object.getOwnPropertyNames(Object.prototype)
     * but __proto__ is an accessor property, not a regular property in some contexts.
     */
    it('should block __proto__ access', async () => {
      const jailedFunc = createJailedFunction({
        source: `(obj) => {
          return obj["__proto__"]
        }`
      })

      const testObj = { name: 'test' }
      const result = jailedFunc([testObj])

      // If vulnerability exists, result will be Object.prototype (truthy)
      // If protected, result should be undefined
      expect(result).toBeUndefined()
    })

    /**
     * Test: __proto__ setter should be blocked
     */
    it('should block __proto__ setter', async () => {
      const jailedFunc = createJailedFunction({
        readOnlyArguments: false,
        source: `(obj) => {
          obj["__proto__"] = { polluted: true }
          return "set succeeded"
        }`
      })

      const testObj = { name: 'test' }

      try {
        jailedFunc([testObj])
        // If we get here, check if prototype was polluted
        expect((Object.prototype as any).polluted).toBeUndefined()
      } catch (e) {
        // Being blocked is the correct behavior
      }
    })

    /**
     * VULNERABILITY: constructor.constructor access for code execution
     *
     * Even with constructor blocked, there might be paths to access it.
     */
    it('should block indirect constructor access via toString', async () => {
      const jailedFunc = createJailedFunction({
        source: `(fn) => {
          // Attempt to get Function constructor indirectly
          const str = fn.toString
          return str.constructor
        }`
      })

      const testFn = () => { }
      const result = jailedFunc([testFn])

      // Should be undefined, not Function constructor
      expect(result).toBeUndefined()
    })

    /**
     * Test: prototype property access should be blocked
     */
    it('should block prototype property access', async () => {
      const jailedFunc = createJailedFunction({
        source: `(fn) => {
          return fn["prototype"]
        }`
      })

      const testFn = function () { }
      const result = jailedFunc([testFn])

      expect(result).toBeUndefined()
    })

  })

  describe('VM Escape Attempts', () => {

    /**
     * Test: this context escape attempt
     *
     * In arrow functions, 'this' refers to the enclosing scope.
     * This test verifies it cannot be used to escape.
     */
    it('should prevent escape via this context', async () => {
      // Arrow functions don't have their own 'this', so this tests the compiled output
      const create = () => createJailedFunction({
        source: `() => {
          return this
        }`
      })

      // Should either throw at compile time or return undefined at runtime
      try {
        const fn = create()
        const result = fn()
        // If we get here, 'this' should be undefined or a safe value
        expect(result === globalThis).toBeFalse()
      } catch (e) {
        // Compile-time rejection is also acceptable
        expect(e).toBeDefined()
      }
    })

    /**
     * VULNERABILITY: Accessing Function via bound function properties
     */
    it('should block Function constructor via bind', async () => {
      const jailedFunc = createJailedFunction({
        source: `(fn) => {
          const bound = fn.bind(null)
          return bound.constructor
        }`
      })

      const testFn = () => 1
      const result = jailedFunc([testFn])

      expect(result).toBeUndefined()
    })

    /**
     * Test: Accessing Function via call/apply
     */
    it('should block Function constructor via call', async () => {
      const jailedFunc = createJailedFunction({
        source: `(fn) => {
          return fn.call.constructor
        }`
      })

      const testFn = () => 1
      const result = jailedFunc([testFn])

      expect(result).toBeUndefined()
    })

  })

  describe('Error Information Leakage', () => {

    /**
     * VULNERABILITY: Stack traces may expose internal file paths
     *
     * When a runtime error occurs, the stack trace contains internal paths.
     */
    it('should sanitize error stack traces from runtime errors', async () => {
      const jailedFunc = createJailedFunction({
        source: `(obj) => {
          // Trigger a runtime error by accessing property of undefined
          return obj.nonexistent.value
        }`
      })

      try {
        jailedFunc([{ }])
        fail('Should have thrown')
      } catch (e: any) {
        const stack = e.stack || ''

        // These paths should NOT appear in user-facing errors
        const leaksInternalPaths = (
          stack.includes('jailed-function/src/') ||
          stack.includes('runtime.ts') ||
          stack.includes('jailed-function.ts')
        )

        // Currently this will likely be true (vulnerability exists)
        // When fixed, this should be false
        if (leaksInternalPaths) {
          fail(`VULNERABILITY CONFIRMED: Stack trace leaks internal paths:\n${stack.substring(0, 500)}`)
        }
      }
    })

    /**
     * VULNERABILITY: Compilation errors expose internal implementation
     */
    it('should not expose babel internals in compilation errors', async () => {
      try {
        // Try to use a disallowed construct
        createJailedFunction({
          source: `function foo() { return 1 }` // function declarations not allowed
        })
        fail('Should have thrown')
      } catch (e: any) {
        const message = e.message || ''
        const stack = e.stack || ''

        // Should give a clean error, not expose babel internals
        const exposesInternals = (
          stack.includes('@babel/core') ||
          stack.includes('node_modules')
        )

        if (exposesInternals) {
          fail(`VULNERABILITY CONFIRMED: Compilation error exposes internals:\n${stack.substring(0, 500)}`)
        }
      }
    })

  })

  describe('Memory Limit Bypass', () => {

    /**
     * VULNERABILITY: Memory tracking doesn't account for native string operations
     *
     * String operations like repeat() allocate memory outside of tracked proxies.
     */
    it('should enforce memory limit on string operations', async () => {
      const jailedFunc = createJailedFunction({
        memoryLimit: 1024, // 1KB limit
        source: `() => {
          // This creates a ~10KB string but may bypass memory tracking
          const str = "x".repeat(10000)
          return str.length
        }`
      })

      try {
        const result = jailedFunc()
        // If we get here with the result, memory tracking was bypassed
        if (result === 10000) {
          fail('VULNERABILITY CONFIRMED: String.repeat bypassed memory limit - created 10KB string with 1KB limit')
        }
      } catch (e: any) {
        // Should be MemoryLimitError
        expect(e).toBeInstanceOf(MemoryLimitError)
      }
    })

    /**
     * VULNERABILITY: Array created via native methods bypass tracking
     */
    it('should track memory for Array.from allocations', async () => {
      const jailedFunc = createJailedFunction({
        memoryLimit: 1024, // 1KB limit
        availableGlobals: ['Array'],
        source: `() => {
          // Create large array via native method - may bypass tracking
          const arr = Array.from({ length: 10000 }, (_, i) => i)
          return arr.length
        }`
      })

      try {
        const result = jailedFunc([], { Array })
        // If we get here, memory tracking was bypassed for Array.from
        if (result === 10000) {
          fail('VULNERABILITY CONFIRMED: Array.from bypassed memory limit')
        }
      } catch (e: any) {
        expect(e).toBeInstanceOf(MemoryLimitError)
      }
    })

    /**
     * VULNERABILITY: Concatenation in a single expression bypasses tracking
     */
    it('should track memory for string concatenation', async () => {
      const jailedFunc = createJailedFunction({
        memoryLimit: 100, // 100 bytes limit
        source: `() => {
          // Single expression concatenation
          const s = "a" + "b".repeat(1000)
          return s.length
        }`
      })

      try {
        const result = jailedFunc()
        if (result > 100) {
          fail(`VULNERABILITY CONFIRMED: String concatenation bypassed memory limit - created ${result} char string with 100 byte limit`)
        }
      } catch (e: any) {
        expect(e).toBeInstanceOf(MemoryLimitError)
      }
    })

  })

  describe('Native Object Method Risks', () => {

    /**
     * Test: Object.create can create objects with arbitrary prototypes
     */
    it('should handle Object.create with null prototype safely', async () => {
      const jailedFunc = createJailedFunction({
        availableGlobals: ['Object'],
        readOnlyResult: false,
        source: `() => {
          const obj = Object.create(null)
          obj.name = 'test'
          return obj
        }`
      })

      const result = jailedFunc([], { Object })
      expect(result.name).toBe('test')
    })

    /**
     * Test: Verify prototype pollution doesn't escape sandbox
     */
    it('should not allow prototype pollution to escape sandbox', async () => {
      // Store original state
      const originalPolluted = (Object.prototype as any).polluted

      const jailedFunc = createJailedFunction({
        readOnlyResult: false,
        readOnlyGlobals: false,
        readOnlyArguments: false,
        availableGlobals: ['target'],
        source: `(source) => {
          // Attempt prototype pollution via __proto__
          const obj = {}
          obj["__proto__"] = { polluted: "yes" }
          return obj
        }`
      })

      try {
        jailedFunc([{}], { target: {} })
      } catch (e) {
        // Expected to throw or be blocked
      }

      // Verify Object.prototype wasn't polluted
      expect((Object.prototype as any).polluted).toBe(originalPolluted)
    })

    /**
     * Test: hasOwnProperty is a protected property and should be blocked
     *
     * Note: hasOwnProperty is in Object.prototype, so it's protected.
     * Users should use Object.keys or 'in' operator instead.
     */
    it('should block direct hasOwnProperty access (protected property)', async () => {
      const jailedFunc = createJailedFunction({
        availableGlobals: ['Object'],
        source: `(obj) => {
          // hasOwnProperty is a protected property
          const hop = Object.hasOwnProperty
          return hop
        }`
      })

      const result = jailedFunc([{ name: 'test' }], { Object })
      // hasOwnProperty is protected, so it returns undefined
      expect(result).toBeUndefined()
    })

  })

  describe('Async Timeout Edge Cases', () => {

    /**
     * VULNERABILITY: Promise.all with many promises might delay timeout check
     */
    it('should timeout even with many concurrent promises', async () => {
      const jailedFunc = createJailedFunction({
        timeout: 100,
        availableGlobals: ['Promise'],
        source: `async () => {
          // Create many promises that resolve slowly
          const promises = []
          for (let i = 0; i < 1000; i++) {
            promises.push(Promise.resolve(i))
          }
          return await Promise.all(promises)
        }`
      })

      const start = Date.now()
      try {
        await jailedFunc([], { Promise })
        const elapsed = Date.now() - start
        // This should complete quickly since promises resolve immediately
        expect(elapsed).toBeLessThan(1000)
      } catch (e) {
        // TimeoutError is acceptable
        expect(e).toBeInstanceOf(TimeoutError)
      }
    })

  })

})

/**
 * Summary of expected test results:
 *
 * Tests demonstrating VULNERABILITIES (should fail with "VULNERABILITY CONFIRMED"):
 * - ReDoS timeout bypass
 * - JSON.parse timeout bypass
 * - String.repeat timeout bypass
 * - Memory limit bypass via native operations
 * - Error stack trace information leakage
 *
 * Tests that should PASS (library protects correctly):
 * - __proto__ access blocking
 * - constructor access blocking
 * - prototype property blocking
 * - VM escape prevention
 * - Prototype pollution containment
 *
 * Run with: npm test
 */
