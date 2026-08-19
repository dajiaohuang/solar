import { createStore } from './createStore'

export type MissionState = {
  departureId: string
  arrivalId: string
  departureDate: string
  arrivalDate: string
}

export const DEFAULT_MISSION_STATE: MissionState = {
  departureId: 'earth',
  arrivalId: 'mars',
  departureDate: '2026-11-15',
  arrivalDate: '2027-08-01',
}

export const missionStore = createStore(DEFAULT_MISSION_STATE)
export const missionActions = { patch: missionStore.setState }
