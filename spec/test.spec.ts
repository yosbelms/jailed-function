import 'jasmine'
import { createJailedFunction } from '../src'
import { TimeoutError, MemoryLimitError } from '../src/error'
import delay from 'delay'

describe('JailedFunction', () => {

  describe('should throw', () => {

    it('if it is not an async function', async () => {
      const create = () => createJailedFunction({
        source: `const x = 1`
      })
      expect(create).toThrow()
    })

    it('on timeout', async () => {
      const jailedFunc = createJailedFunction({
        timeout: 10,
        source: `async() => {
          while(true){}
        }`
      })

      await expectAsync(jailedFunc()).toBeRejectedWithError(TimeoutError)
    })

    it('on memory limit exceed', async () => {
      const jailedFunc = createJailedFunction({
        memoryLimit: 100,
        source: `async() => {
          const arr = []
          while(true) arr.push(0)
        }`
      })

      try {
        await jailedFunc()
      } catch (e) {
        expect((e as Error).constructor).toBe(MemoryLimitError)
      }
    })

    it('on access to undeclared global', async () => {
      const create = () => createJailedFunction({
        globalNames: [],
        source: `async() => UndeclaredGlobal`
      })

      expect(create).toThrow()
    })

    it('on reassign global', async () => {
      const jailedFunc = createJailedFunction({
        source: `async() => Object = null`
      })

      await expectAsync(jailedFunc(void 0)).toBeRejected()
    })

  })

  // bug
  it('should not properly call a function (non member expression) when its arguments are member expressions', async () => {
    const len = 1
    const jailedFunc = createJailedFunction({
      globalNames: ['Array'],
      source: `async(len) => {
        const obj = { len: len }
        return Array(obj.len)
      }`
    })

    const result = await jailedFunc([len], { Array })
    expect(result.length).toEqual(len)
  })

  // bug
  // throwing timeout error after two consecutive sync time checks
  // and the time elapsed since the previous async time check
  // was greater than the budget time for sync execution
  it('should call time async check after each await expressions', async () => {
    const service = {
      async asyncFn() {
        await delay(500)
        return 1
      }
    }

    const jailedFunc = createJailedFunction({
      timeout: 1000,
      globalNames: ['service'],
      source: `async() => {
        const result = await service.asyncFn();
        const arrSyncCheckTrigger = [1, 2].map(x => x)
        return result + arrSyncCheckTrigger[0]
      }`
    })

    const result = await jailedFunc([], { service })
    expect(result).toEqual(2)
  })

  // bug
  it('should allow to use Promise static methods', async () => {
    const jailedFunc = createJailedFunction({
      globalNames: ['Promise', 'console'],
      source: `async (x) => {
        return await Promise.all(x)
      }`
    })
    const param = [1, 2]
    const result = await jailedFunc([param])
    expect(result).toEqual(param)
  })

  // because Terser trasforms some code to sequence syntax on minify
  it('should accept sequence expression', async () => {
    const create = () => createJailedFunction({
      source: `async () => (2, 3)`
    })
    expect(create).not.toThrow()
  })

  it('should throw on passing global vars not declared in "globalNames"', async () => {
    const jailedFunction = createJailedFunction({
      source: `async () => null`
    })

    const callPassingGlobal = () => jailedFunction(void 0, { someGlobal: Object })
    expect(callPassingGlobal).toThrow()
  })

  it('should throw when access a global not declared in globalNames', async () => {
    // native support
    let create = () => createJailedFunction({
      source: `async () => await Promise.resolve(1)`
    })
    expect(create).not.toThrow()

    // not allowed in global names
    create = () => createJailedFunction({
      source: `async () => process`
    })
    expect(create).toThrow()
  })

  it('should make result read-only by default', async () => {
    const obj = { name: 'John' }
    // read only
    let jailedFunction = createJailedFunction({
      source: `async (obj) => obj`
    })
    let result = await jailedFunction([obj])
    expect(result === obj).toBeFalse()
    expect(result).toEqual(obj)
    expect(() => result.name = 'Peter').toThrow()

    // don't make result read-only
    jailedFunction = createJailedFunction({
      readOnlyResult: false,
      source: `async (obj) => obj`
    })
    result = await jailedFunction([obj])
    expect(result === obj).toBeTrue()
    expect(result).toEqual(obj)
  })

  it('should collaborate. Functions should not not overtake', async () => {
    let jailedFunction = createJailedFunction({
      readOnlyResult: false,
      source: `async (rid, count, mem) => {
        let i = count
        while (--i) mem.push(rid)
      }`
    })

    const sharedMem: any[] = []

    await Promise.all([
      jailedFunction([1, 100, sharedMem]),
      jailedFunction([2, 100, sharedMem])
    ])

    // both executed
    expect(sharedMem.indexOf(1)).not.toBe(-1)
    expect(sharedMem.indexOf(2)).not.toBe(-1)

    // both performed equal number of iterations
    expect(
      sharedMem.filter(item => item === 1).length
    ).toBe(
      sharedMem.filter(item => item === 2).length
    )
  })

  it('arguments should be read-only', async () => {
    const jailedFunction = createJailedFunction({
      source: `async (obj) => obj.name = 'Peter'`
    })
    const obj = { name: 'John' }
    await expectAsync(jailedFunction([obj])).toBeRejected()
  })

  it('imported globals should be read-only', async () => {
    const jailedFunction = createJailedFunction({
      globalNames: ['obj'],
      source: `async () => obj.name = 'Peter'`
    })
    const obj = { name: 'John' }
    await expectAsync(jailedFunction([], { obj: obj })).toBeRejected()
  })

})
