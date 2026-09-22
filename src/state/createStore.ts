import { useSyncExternalStore } from 'react'

type Listener = () => void

export function createStore<State extends object>(initialState: State) {
  let state = initialState
  const listeners = new Set<Listener>()

  const getState = () => state
  const subscribe = (listener: Listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const setState = (update: Partial<State> | ((previous: State) => Partial<State>)) => {
    const patch = typeof update === 'function' ? update(state) : update
    // Object spread always creates a new identity. Preserve the snapshot and
    // avoid notifying subscribers when every enumerable patch field is equal.
    const changed = (Reflect.ownKeys(patch) as (keyof State)[]).some(key =>
      Object.prototype.propertyIsEnumerable.call(patch, key)
      && (!Object.hasOwn(state, key) || !Object.is(patch[key], state[key])))
    if (!changed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  function useStore<Selection = State>(selector?: (value: State) => Selection) {
    const select = selector ?? ((value: State) => value as unknown as Selection)
    return useSyncExternalStore(
      subscribe,
      () => select(state),
      () => select(initialState),
    )
  }

  return { getState, setState, subscribe, useStore }
}
