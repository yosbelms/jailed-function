import { createJailedFunction } from '../src'
import { readOnly } from '../src/util'

const len = 1000000
const perfTag = `perf iterating ${len} items`

const createArray = (len: number) => {
  const arr: any[] = []
  for (let i = 0; i < len; i++) {
    arr.push({ id: 1, name: 'John', age: 23 })
  }
  return arr
}

const src = `async (arr) => {
  const result = []
  for (let i = 0; i < arr.length; i++) {
    result.push(arr[i].name)
  }
  return result
}`

let jailedFunction = createJailedFunction({
  source: src
})

let jailedFunctionNoReadOnly = createJailedFunction({
  readOnlyResult: false,
  readOnlyArguments: false,
  readOnlyGlobals: false,
  source: src
})

  ; (async () => {
    console.time(perfTag)
    const arr = createArray(len)
    console.timeEnd(perfTag)

    console.time('read only')
    await jailedFunction([arr])
    console.timeEnd('read only')

    console.time('no read only')
    await jailedFunctionNoReadOnly([arr])
    console.timeEnd('no read only')

  })()

