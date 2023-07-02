import 'jasmine'
import { createJailedFunction } from '../src'

// see this file for attacks: https://github.com/patriksimek/vm2/blob/master/test/nodevm.js

describe('JailedFunction attacks', () => {

  it('prevent global access', async () => {
    const create = () => createJailedFunction({
      source: `async () => process.exit()`
    })
    expect(create).toThrow()
  })

  it('arguments attack', async () => {
    const create = () => createJailedFunction({
      source: `async () => arguments.callee.caller.constructor`
    })
    expect(create).toThrow()
  })

  it('contructor attack', async () => {
    const jailedFunction = createJailedFunction({
      globalNames: ['console'],
      cloneResult: false,
      source: `async () => {
        return console.log.constructor
      }`
    })
    const result = await jailedFunction(void 0, { console })
    expect(result).toBeUndefined()
  })

})
