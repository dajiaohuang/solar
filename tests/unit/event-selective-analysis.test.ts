import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CelestialBody } from '../../src/types'
import type { EventAnalysisRequest, EventAnalysisResponse, EventAnalysisCancel } from '../../src/workers/conjunction.worker'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
const sun: CelestialBody = { id: 'sun', name: 'Sun', kind: 'star', color: '#fff', size: 1, source: 'jpl-approx' }
const body: CelestialBody = { id: 'test', name: 'Test', kind: 'asteroid', color: '#fff', size: 1, source: 'mpcorb',
  orbit: { model: 'keplerian', epochJd: 2451545, semiMajorAxisAU: 1, eccentricity: .2,
    inclinationDeg: 0, ascendingNodeDeg: 0, argPeriapsisDeg: 0, meanAnomalyDeg: 0, meanMotionDegPerDay: 1 } }
const request: EventAnalysisRequest = { type: 'run', requestId: 1, bodies: [body], resolutionBodies: [sun, body],
  referenceId: 'unavailable-observer', centerJulianDay: 2451545, windowDays: 10, thresholdAU: 1,
  eventKinds: ['perihelion'], sampleCount: 40 }

async function run(overrides: Partial<EventAnalysisRequest>, cancelAfterSampling = false) {
  let finish!: (result: EventAnalysisResponse) => void
  const done = new Promise<EventAnalysisResponse>(resolve => { finish = resolve })
  const scope = { onmessage: null as ((event: MessageEvent<EventAnalysisRequest | EventAnalysisCancel>) => void) | null,
    postMessage(message: EventAnalysisResponse) {
      if (cancelAfterSampling && message.type === 'progress' && (message.progress ?? 0) > .2) {
        scope.onmessage!({ data: { type: 'cancel', requestId: 1 } } as MessageEvent<EventAnalysisCancel>)
      }
      if (message.type !== 'progress') finish(message)
    } }
  vi.stubGlobal('self', scope)
  await import('../../src/workers/conjunction.worker')
  scope.onmessage!({ data: { ...request, ...overrides } } as MessageEvent<EventAnalysisRequest>)
  return done
}

describe('only requested event geometry is required', () => {
  it('finds heliocentric periapsis without resolving an unrelated missing observer', async () => {
    const result = await run({})
    expect(result.type).toBe('result')
    expect(result.events).toHaveLength(1)
    expect(result.events![0].kind).toBe('perihelion')
    expect(result.events![0].value).toBeCloseTo(.8, 8)
  })
  it('measures pair distances without resolving an angular observer', async () => {
    const result = await run({ bodies: [sun, body], eventKinds: ['close-approach'] })
    expect(result.type).toBe('result')
    expect(result.events).toHaveLength(1)
    expect(result.events![0].value).toBeCloseTo(.8, 8)
  })
  it('continues to reject an unavailable observer for angular events', async () => {
    expect((await run({ bodies: [sun, body], eventKinds: ['conjunction'] })).type).toBe('error')
  })
  it('does not publish an apsides-only result after cancellation', async () => {
    expect((await run({}, true)).type).toBe('cancelled')
  })
})
