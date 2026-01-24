import { createJailedFunction } from '../src'
import { TimeoutError } from '../src/error'
import delay from 'delay'

describe('Worker Lifecycle', () => {
  it('should execute a dangerous regex using a worker and succeed', async () => {
    const fn = createJailedFunction({
      source: `async (str) => str.match(/(a+)+$/)`,
      enableNativeProtection: true,
      syncTimeout: 1000
    })
    
    // This is "dangerous" but small enough to succeed quickly
    const result = await fn(['aaaaaaaaaa'])
    expect(result).toBeDefined()
    expect(result[0]).toBe('aaaaaaaaaa')
  })

  it('should recover from a worker timeout', async () => {
    const fn = createJailedFunction({
      source: `async (str) => str.match(/(a+)+$/)`,
      enableNativeProtection: true,
      syncTimeout: 100 // Short timeout to trigger termination
    })
    
    // 1. Trigger a timeout (should terminate the worker)
    const evilInput = 'a'.repeat(25) + 'X'
    await expectAsync(fn([evilInput])).toBeRejectedWith(jasmine.any(TimeoutError))
    
    // 2. The next call should still work (should spawn a new worker)
    const result = await fn(['aaa'])
    expect(result[0]).toBe('aaa')
  })

  it('should reuse the worker for multiple calls', async () => {
    const fn = createJailedFunction({
      source: `async (str) => str.match(/(a+)+$/)`,
      enableNativeProtection: true,
      syncTimeout: 1000
    })
    
    // Warm up the worker
    await fn(['a'])
    
    const start = Date.now()
    for (let i = 0; i < 10; i++) {
      await fn(['a'])
    }
    const duration = Date.now() - start
    
    // If it was spawning a new worker every time (15ms each), 
    // it would take at least 150ms. 
    // With reuse, it should be much faster (likely < 50ms total)
    expect(duration).toBeLessThan(100)
  })

  it('should terminate the worker after idle timeout', async () => {
    const fn = createJailedFunction({
      source: `async (str) => str.match(/(a+)+$/)`,
      enableNativeProtection: true,
      syncTimeout: 1000
    })
    
    // 1. Spawn worker
    await fn(['a'])
    
    // 2. Wait for idle timeout (5s in delegate.ts + some buffer)
    await delay(6000)
    
    // 3. Next call should still work (should spawn a new worker)
    const result = await fn(['a'])
    expect(result[0]).toBe('a')
  }, 10000)
})
