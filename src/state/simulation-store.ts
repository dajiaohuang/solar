import { simulationClock } from '../engine/clock/SimulationClock'
import { todayJulianDay } from '../lib/julianDate'
import { createStore } from './createStore'
import type { RenderQuality } from '../types'

export type ViewMode = '2d' | '3d'

export type SimulationState = {
  referenceId: string
  comparisonReferenceId: string
  comparisonEnabled: boolean
  historyDays: number
  sampleCount: number
  viewMode: ViewMode
  renderQuality: RenderQuality
  showCatalogCloud: boolean
  showEcliptic: boolean
  showHillSphere: boolean
  showLaplaceSoi: boolean
  showLagrange: boolean
  showOrbits: boolean
  showSpacecraft: boolean
  zoom: number
  viewOffset: { x: number; y: number }
}
export const DEFAULT_SIMULATION_STATE: SimulationState = {
  referenceId: 'sun',
  comparisonReferenceId: 'earth',
  comparisonEnabled: false,
  historyDays: 365,
  sampleCount: 180,
  viewMode: '3d',
  renderQuality: 'auto',
  showCatalogCloud: false,
  showEcliptic: true,
  showHillSphere: false,
  showLaplaceSoi: false,
  showLagrange: false,
  showOrbits: false,
  showSpacecraft: false,
  zoom: 1,
  viewOffset: { x: 0, y: 0 },
}

export const simulationStore = createStore(DEFAULT_SIMULATION_STATE)

export const simulationActions = {
  patch: simulationStore.setState,
  seek: (julianDay: number) => simulationClock.seek(julianDay),
  resetTime: () => simulationClock.seek(todayJulianDay()),
  setRate: (rate: number) => simulationClock.setRate(rate),
  togglePlayback: () => simulationClock.toggle(),
  play: () => simulationClock.play(),
  pause: () => simulationClock.pause(),
}
