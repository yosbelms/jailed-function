const { register } = require('ts-node')
const path = require('path')
register({
  project: path.resolve('tsconfig.json')
})