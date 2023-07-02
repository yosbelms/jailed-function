import { createJailedFunction } from '../src'

const len = 100000
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
  cloneResult: false,
  readOnlyArguments: false,
  readOnlyGlobals: false,
  source: src
})


  ; (async () => {

    console.time(perfTag)
    const arr = createArray(len)
    console.timeLog(perfTag)
    await jailedFunction([arr])
    console.timeLog(perfTag)
    await jailedFunctionNoReadOnly([arr])
    console.timeEnd(perfTag)

  })()

