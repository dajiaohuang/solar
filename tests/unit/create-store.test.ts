import { expect, it, vi } from 'vitest'
import { createStore } from '../../src/state/createStore'

it('retains the snapshot and emits nothing for empty or identical patches', () => {
  const records = ['earth']
  const store = createStore({ progress: 0, records, invalid: NaN })
  const initial = store.getState(), listener = vi.fn()
  store.subscribe(listener)
  for (let index = 0; index < 1000; index++) store.setState({ progress: 0 })
  store.setState({})
  store.setState(state => ({ records: state.records, invalid: NaN }))
  expect(store.getState()).toBe(initial)
  expect(listener).not.toHaveBeenCalled()
})

it('publishes changed values and new explicit fields, including symbols and signed zero', () => {
  const identity = Symbol('identity')
  const store = createStore<{ zero: number; optional?: string; [identity]: string }>({ zero: 0, [identity]: 'before' })
  const listener = vi.fn(() => store.getState())
  const unsubscribe = store.subscribe(listener)
  store.setState({ zero: -0 })
  expect(Object.is(store.getState().zero, -0)).toBe(true)
  store.setState({ optional: undefined })
  expect(Object.hasOwn(store.getState(), 'optional')).toBe(true)
  store.setState({ [identity]: 'after' })
  expect(listener).toHaveBeenCalledTimes(3)
  expect(listener.mock.results[2].value).toBe(store.getState())
  unsubscribe()
  store.setState({ zero: 1 })
  expect(listener).toHaveBeenCalledTimes(3)
})

it('preserves shallow replacement semantics without treating hidden fields as patches', () => {
  const store = createStore({ records: ['earth'] })
  const listener = vi.fn()
  store.subscribe(listener)
  store.setState(Object.defineProperty({}, 'records', { value: ['mars'], enumerable: false }))
  expect(listener).not.toHaveBeenCalled()
  const replacement = ['earth']
  store.setState({ records: replacement })
  expect(listener).toHaveBeenCalledOnce()
  expect(store.getState().records).toBe(replacement)
})
