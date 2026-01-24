import { NodePath, types } from '@babel/core'
import { reservedIdentifiers } from './util'

const getParentFunctionNode = (t: any, path: any) => {
  let parent = path
  let node = path.node
  while (node) {
    node = parent.node
    if (node && (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node))) {
      return node
    }
    parent = parent.parentPath
  }
}

const createCheckAsyncTime = (t: any, state: any) => {
  const callExpr = t.callExpression(
    t.memberExpression(state.runtimeInstanceIdentifier, t.identifier('checkAsync')), []
  )
  callExpr.isRuntimeCall = true
  const awaitExpr = t.awaitExpression(callExpr)
  awaitExpr.isRuntimeAwait = true
  return awaitExpr
}

const createCheckSyncTime = (t: any, state: any) => {
  const expr = t.callExpression(
    t.memberExpression(state.runtimeInstanceIdentifier, t.identifier('checkSync')), []
  )
  expr.isRuntimeCall = true
  return expr
}

const handleLoop = (t: any, path: any, state: any) => {
  const fnNode = getParentFunctionNode(t, path)
  const controlCheck = fnNode.async ? createCheckAsyncTime(t, state) : createCheckSyncTime(t, state)
  let body = path.node.body
  if (!t.isBlockStatement(body)) {
    path.node.body = t.blockStatement([t.cloneDeep(body)])
  }
  path.node.body.body.unshift(controlCheck)
}

/**
 * Helper to check if an array has any spread elements
 */
const hasSpreadElement = (t: any, elements: any[]): boolean => {
  return elements.some((el: any) => t.isSpreadElement(el))
}

/**
 * Helper to create a [value, isSpread] tuple for spread runtime methods
 * Marks it as a runtime call to prevent further transformation
 */
const createSpreadTuple = (t: any, value: any, isSpread: boolean): any => {
  const tuple = t.arrayExpression([value, t.booleanLiteral(isSpread)])
  tuple.isRuntimeCall = true  // Prevent ArrayExpression visitor from wrapping this
  return tuple
}

export const createRuntimePlugin = () => {
  return ({ types: t }: { types: any }) => {
    return {
      visitor: {
        ObjectExpression: (path: any, state: any) => {
          const node = path.node

          // Skip if this object is already marked as a runtime object
          if (node.isRuntimeCall) return

          // Check if object has spread elements - always transform these for safety
          const hasSpread = node.properties.some((p: any) => t.isSpreadElement(p))

          if (hasSpread) {
            // Transform {...a, key: val, ...b} into spreadObject([[a, true], [{key: val}, false], [b, true]])
            const tuples: any[] = []
            let currentProps: any[] = []

            for (const prop of node.properties) {
              if (t.isSpreadElement(prop)) {
                // Flush accumulated properties as a regular object
                if (currentProps.length > 0) {
                  const objLiteral = t.objectExpression(currentProps)
                  tuples.push(createSpreadTuple(t, objLiteral, false))
                  currentProps = []
                }
                // Add the spread source
                tuples.push(createSpreadTuple(t, prop.argument, true))
              } else {
                currentProps.push(prop)
              }
            }

            // Flush remaining properties
            if (currentProps.length > 0) {
              const objLiteral = t.objectExpression(currentProps)
              tuples.push(createSpreadTuple(t, objLiteral, false))
            }

            const tuplesArray = t.arrayExpression(tuples)
            tuplesArray.isRuntimeCall = true  // Prevent transformation of outer array
            const spreadCall = t.callExpression(
              t.memberExpression(
                state.runtimeInstanceIdentifier,
                t.identifier('spreadObject')
              ),
              [tuplesArray]
            )
            spreadCall.isRuntimeCall = true
            path.replaceWith(spreadCall)
          } else {
            // No spread - use regular createObj (skip if already inside runtime call)
            if (path.parent.isRuntimeCall) return
            const allocExpr = t.callExpression(
              t.memberExpression(
                state.runtimeInstanceIdentifier,
                t.identifier('createObj')), [node]
            )
            allocExpr.isRuntimeCall = true
            path.replaceWith(allocExpr)
          }
        },

        ArrayExpression: (path: any, state: any) => {
          const node = path.node

          // Skip if this array is already marked as a runtime array (tuples for spread operations)
          if (node.isRuntimeCall) return

          // Check if array has spread elements - always transform these for safety (even in runtime calls)
          if (hasSpreadElement(t, node.elements)) {
            // Transform [...a, x, ...b] into spreadArray([[a, true], [x, false], [b, true]])
            const tuples: any[] = []

            for (const element of node.elements) {
              if (element === null) {
                // Hole in array - push undefined
                tuples.push(createSpreadTuple(t, t.identifier('undefined'), false))
              } else if (t.isSpreadElement(element)) {
                tuples.push(createSpreadTuple(t, element.argument, true))
              } else {
                tuples.push(createSpreadTuple(t, element, false))
              }
            }

            const tuplesArray = t.arrayExpression(tuples)
            tuplesArray.isRuntimeCall = true  // Prevent transformation of outer array
            const spreadCall = t.callExpression(
              t.memberExpression(
                state.runtimeInstanceIdentifier,
                t.identifier('spreadArray')
              ),
              [tuplesArray]
            )
            spreadCall.isRuntimeCall = true
            path.replaceWith(spreadCall)
          } else {
            // No spread - use regular createArr (skip if already inside runtime call)
            if (path.parent.isRuntimeCall) return
            const allocExpr = t.callExpression(
              t.memberExpression(
                state.runtimeInstanceIdentifier,
                t.identifier('createArr')), [node]
            )
            allocExpr.isRuntimeCall = true
            path.replaceWith(allocExpr)
          }
        },

        CallExpression: (path: any, state: any) => {
          if (path.node.isRuntimeCall) return

          const args = path.node.arguments

          // Check if call has spread arguments
          if (hasSpreadElement(t, args)) {
            const callee = path.node.callee

            // Build argument tuples
            const tuples: any[] = []
            for (const arg of args) {
              if (t.isSpreadElement(arg)) {
                tuples.push(createSpreadTuple(t, arg.argument, true))
              } else {
                tuples.push(createSpreadTuple(t, arg, false))
              }
            }

            // Determine if it's a method call (obj.method(...args)) or direct call (fn(...args))
            if (t.isMemberExpression(callee)) {
              // Method call: obj.method(...args) -> spreadCall(obj.method.bind(obj), tuples)
              // We need to preserve 'this' context
              const { object, property } = callee

              // Skip if it's a runtime call
              if (object === state.runtimeInstanceIdentifier) return

              const propName = callee.computed ? property : t.stringLiteral(property.name)

              // Create: $$r.spreadCall($$r.getProp(obj, 'method'), tuples, obj)
              const getPropCall = t.callExpression(
                t.memberExpression(state.runtimeInstanceIdentifier, t.identifier('getProp')),
                [object, propName]
              )
              getPropCall.isRuntimeCall = true

              const tuplesArray = t.arrayExpression(tuples)
              tuplesArray.isRuntimeCall = true  // Prevent transformation of tuples array

              const spreadCall = t.callExpression(
                t.memberExpression(
                  state.runtimeInstanceIdentifier,
                  t.identifier('spreadCall')
                ),
                [getPropCall, tuplesArray, object]
              )
              spreadCall.isRuntimeCall = true
              path.replaceWith(spreadCall)
            } else {
              // Direct function call: fn(...args) -> spreadCall(fn, tuples)
              const tuplesArray = t.arrayExpression(tuples)
              tuplesArray.isRuntimeCall = true  // Prevent transformation of tuples array

              const spreadCall = t.callExpression(
                t.memberExpression(
                  state.runtimeInstanceIdentifier,
                  t.identifier('spreadCall')
                ),
                [callee, tuplesArray]
              )
              spreadCall.isRuntimeCall = true
              path.replaceWith(spreadCall)
            }
          }
          // If no spread, let other visitors handle it (MemberExpression for method calls)
        },

        ObjectPattern: (path: any, state: any) => {
          path.node.properties.forEach((prop: any) => {
            if (prop.computed) {
              const destructKey = t.callExpression(
                t.memberExpression(
                  state.runtimeInstanceIdentifier,
                  t.identifier('computedProp')), [prop.key]
              )
              destructKey.isRuntimeCall = true
              prop.key = destructKey
            } else {
              // check props var names here
            }
          })
        },

        ObjectProperty: (path: any, state: any) => {
          const prop = path.node
          if (prop.computed) {
            const destructKey = t.callExpression(
              t.memberExpression(
                state.runtimeInstanceIdentifier,
                t.identifier('computedProp')), [prop.key]
            )
            destructKey.isRuntimeCall = true
            prop.key = destructKey
          } else {
            // check for var names here
          }
        },

        NewExpression: (path: any, state: any) => {
          if (path.parent.isRuntimeCall) return
          const node = path.node
          const allocExpr = t.callExpression(
            t.memberExpression(
              state.runtimeInstanceIdentifier,
              t.identifier('createObj')), [node]
          )
          allocExpr.isRuntimeCall = true
          path.replaceWith(allocExpr)
        },

        // member, getProp, setProp
        MemberExpression: (path: any, state: any) => {
          let { object, property } = path.node
          if (object === state.runtimeInstanceIdentifier) return

          if (!path.node.computed) {
            property = t.stringLiteral(property.name)
            // check for prop names here
          }

          if (t.isAssignmentExpression(path.parent)) {
            const { left, right } = path.parentPath.node
            if (left === path.node) {
              const operator = path.parent.operator
              const setPropExpr = t.callExpression(
                t.memberExpression(
                  state.runtimeInstanceIdentifier,
                  t.identifier('setProp')
                ),
                [object, property, right, t.stringLiteral(operator)]
              )
              setPropExpr.isRuntimeCall = true
              path.parentPath.replaceWith(setPropExpr)
              return
            }
          } else if (
            t.isCallExpression(path.parent)
            && path.parent.callee === path.node
            && !path.parent.isRuntimeCall
          ) {
            const args = path.parent.arguments
            const callProp = t.callExpression(
              t.memberExpression(
                state.runtimeInstanceIdentifier,
                t.identifier('callProp')
              ),
              [object, property, ...args]
            )
            callProp.isRuntimeCall = true
            path.parentPath.replaceWith(callProp)
            return
          }

          const getPropExpr = t.callExpression(
            t.memberExpression(
              state.runtimeInstanceIdentifier,
              t.identifier('getProp')
            ),
            [object, property]
          )
          getPropExpr.isRuntimeCall = true
          path.replaceWith(getPropExpr)
        },

        // time checks
        ForStatement: (path: any, state: any) => handleLoop(t, path, state),
        WhileStatement: (path: any, state: any) => handleLoop(t, path, state),
        DoWhileStatement: (path: any, state: any) => handleLoop(t, path, state),

        ArrowFunctionExpression: (path: any, state: any) => {
          if (!path.isTopLevel) {
            const fnNode = getParentFunctionNode(t, path)
            const controlCheck = fnNode.async ? createCheckAsyncTime(t, state) : createCheckSyncTime(t, state)
            let body = path.node.body
            if (t.isExpression(body)) {
              path.node.body = t.blockStatement([
                t.returnStatement(t.cloneDeep(body))
              ])
            }
            path.node.body.body.unshift(controlCheck)
          }
        },

        TryStatement: (path: any, state: any) => {
          const fnNode = getParentFunctionNode(t, path)
          const controlCheck = fnNode.async ? createCheckAsyncTime(t, state) : createCheckSyncTime(t, state)
          path.node.handler.body.body.unshift(controlCheck)
          path.node.finalizer.body.unshift(controlCheck)
        },

        AwaitExpression: (path: any, state: any) => {
          if (path.node.isRuntimeAwait) return
          const argumentNode = path.node.argument
          const callExpr = t.callExpression(
            t.memberExpression(state.runtimeInstanceIdentifier, t.identifier('awaitPromise')), [
            argumentNode
          ])

          callExpr.isRuntimeAwait = true
          path.node.argument = callExpr
        },

        // program setup
        Program: (path: any, state: any) => {
          const functionPath = path.get('body.0.expression') as NodePath<types.FunctionExpression>
          if (
            path.node.body.length === 1
            && t.isArrowFunctionExpression(functionPath)
            // && functionPath.node.async
          ) {
            ; (functionPath as any).isTopLevel = true
            state.runtimeInstanceIdentifier = t.identifier(reservedIdentifiers.runtime)
          } else {
            throw path.buildCodeFrameError('Expected ArrowFunctionExpression');
          }
        },
      }
    }
  }
}
