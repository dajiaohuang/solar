import { createStore } from './createStore'
import { matchingMissionEpoch } from '../lib/missionEpoch'
import type { AnalysisEphemerisPolicy } from '../engine/ephemeris/analysisEphemeris'

export type MissionState = {
  ephemerisPolicy: AnalysisEphemerisPolicy
  departureId: string
  arrivalId: string
  departureDate: string
  arrivalDate: string
  departureJulianDay?: number
  arrivalJulianDay?: number
}

export const DEFAULT_MISSION_STATE: MissionState = {
  ephemerisPolicy: 'prefer-spk',
  departureId: 'earth',
  arrivalId: 'mars',
  departureDate: '2026-11-15',
  arrivalDate: '2027-08-01',
}

export const missionStore = createStore(DEFAULT_MISSION_STATE)
export const missionActions = { patch(update: Partial<MissionState>) {
  missionStore.setState(previous => {
    const patch = { ...update }
    if (Object.hasOwn(update, 'ephemerisPolicy') && update.ephemerisPolicy !== 'prefer-spk' && update.ephemerisPolicy !== 'require-spk') {
      throw new Error('Invalid mission ephemeris policy')
    }
    for (const [dateKey, epochKey] of [['departureDate', 'departureJulianDay'], ['arrivalDate', 'arrivalJulianDay']] as const) {
      if (Object.hasOwn(update, dateKey) || Object.hasOwn(update, epochKey)) {
        patch[epochKey] = matchingMissionEpoch(update[epochKey], update[dateKey] ?? previous[dateKey])
      }
    }
    return patch
  })
} }
