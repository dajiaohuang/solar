import { describe, expect, it } from 'vitest'
import { eventAnalysisCacheKey, type RunEventAnalysisParams } from '../../src/hooks/useConjunctionWorker'
import type { CelestialBody } from '../../src/types'

const earth: CelestialBody = {
  id: 'earth', name: 'Earth', kind: 'planet', color: '#fff', size: 1, source: 'custom',
  orbit: {
    model: 'keplerian', epochJd: 2451545, semiMajorAxisAU: 1, eccentricity: 0,
    inclinationDeg: 0, ascendingNodeDeg: 0, argPeriapsisDeg: 0,
    meanAnomalyDeg: 0, meanMotionDegPerDay: 0.9856,
  },
}

function params(): RunEventAnalysisParams {
  return {
    bodies: [earth], resolutionBodies: [earth], referenceId: 'sun', centerJulianDay: 2460000,
    windowDays: 365, thresholdAU: 0.05, eventKinds: ['opposition', 'conjunction'],
  }
}

describe('event analysis cache identity', () => {
  it('is order-stable for event kinds and changes with orbit inputs', () => {
    const first = params()
    const reordered = { ...params(), eventKinds: ['conjunction', 'opposition'] as const }
    expect(eventAnalysisCacheKey(reordered as RunEventAnalysisParams)).toBe(eventAnalysisCacheKey(first))
    const changed = params()
    changed.bodies = [{ ...earth, orbit: { ...earth.orbit!, meanAnomalyDeg: 1 } } as CelestialBody]
    expect(eventAnalysisCacheKey(changed)).not.toBe(eventAnalysisCacheKey(first))
  })
})
