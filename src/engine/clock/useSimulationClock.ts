import { useSyncExternalStore } from 'react'
import { simulationClock } from './SimulationClock'

let serverSnapshot = simulationClock.getSnapshot()

export function useSimulationClock() {
  return useSyncExternalStore(
    simulationClock.subscribe,
    simulationClock.getSnapshot,
    () => serverSnapshot,
  )
}
export function refreshServerClockSnapshot() {
  serverSnapshot = simulationClock.getSnapshot()
}
