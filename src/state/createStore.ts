import { useSyncExternalStore } from 'react'

type Listener = () => void

export function createStore<State>(initialState: State) {
  let state = initialState
  const listeners = new Set<Listener>()

  const getState = () => state
  const subscribe = (listener: Listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const setState = (update: Partial<State> | ((previous: State) => Partial<State>)) => {
    const patch = typeof update === 'function' ? update(state) : update
    const next = { ...state, ...patch }
    if (Object.is(next, state)) return
    state = next
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
