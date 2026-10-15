import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CelestialBody } from '../../src/types'
import type { EventAnalysisRequest, EventAnalysisResponse, EventAnalysisCancel } from '../../src/workers/conjunction.worker'
import { assertEventResultBinding } from '../../src/engine/events/eventResultBinding'
import { admitEventAnalysis } from '../../src/engine/events/eventAnalysisLimits'
import { majorBodies } from '../../src/data/majorBodies'

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
    expect(result.sampling).toMatchObject({ method: 'uniform-utc-julian-day-grid-v1', inputTimeScale: 'UTC', sampleCount: 40,
      startJulianDay: 2451540, endJulianDay: 2451550, nominalIntervalDays: 10 / 39, eventCompletenessCertified: false })
    expect(result.events).toHaveLength(1)
    expect(result.events![0].kind).toBe('perihelion')
    expect(result.events![0].value).toBeCloseTo(.8, 8)
    expect(result.ephemeris?.bodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ bodyId: 'test', model: 'approximate-fallback' }),
      expect.objectContaining({ bodyId: 'sun', model: 'heliocentric-origin' }),
    ]))
    expect(result.events![0].ephemeris.policy).toBe('prefer-spk')
    assertEventResultBinding(request, result)
    expect(() => assertEventResultBinding(request, { ...result,
      sampling: { ...result.sampling!, sampleCount: 39 } })).toThrow(/does not match its frozen request/)
    expect(() => assertEventResultBinding(request, { ...result,
      sampling: { ...result.sampling!, inputTimeScale: 'TDB' as 'UTC' } })).toThrow(/does not match its frozen request/)
  })
  it('reports missing SPK as an error instead of publishing an approximate event', async () => {
    const result = await run({ ephemerisPolicy: 'require-spk' })
    expect(result.type).toBe('error')
    expect(result.error).toContain('Strict SPK')
    expect(result.events).toBeUndefined()
  })
  it('measures pair distances without resolving an angular observer', async () => {
    const result = await run({ bodies: [sun, body], eventKinds: ['close-approach'] })
    expect(result.type).toBe('result')
    expect(result.events).toHaveLength(1)
    expect(result.events![0].value).toBeCloseTo(.8, 8)
  })
  it('binds the completed sampling grid even when no event passes the result filter', async () => {
    const noEventRequest: EventAnalysisRequest = { ...request, bodies: [sun, body], eventKinds: ['close-approach'], thresholdAU: 0 }
    const result = await run({ bodies: [sun, body], eventKinds: ['close-approach'], thresholdAU: 0 })
    expect(result.type).toBe('result')
    expect(result.events).toEqual([])
    expect(result.sampling?.sampleCount).toBe(40)
    assertEventResultBinding(noEventRequest, result)
    expect(() => assertEventResultBinding(noEventRequest, { ...result, sampling: undefined })).toThrow(/does not match its frozen request/)
  })
  it('includes the moving reference trajectory when admitting angular-event sampling', () => {
    const earth = majorBodies.find(candidate => candidate.id === 'earth')!
    const targetOnly = admitEventAnalysis({ ...request, sampleCount: undefined, referenceId: 'unavailable-observer', windowDays: 1_825,
      eventKinds: ['conjunction'], resolutionBodies: [sun, body] })
    const withReference = admitEventAnalysis({ ...request, sampleCount: undefined, referenceId: 'earth', windowDays: 1_825,
      eventKinds: ['conjunction'], resolutionBodies: [sun, body, earth] })
    expect(withReference).toBeGreaterThan(targetOnly)
  })
  it('continues to reject an unavailable observer for angular events', async () => {
    expect((await run({ bodies: [sun, body], eventKinds: ['conjunction'] })).type).toBe('error')
  })
  it('does not publish an apsides-only result after cancellation', async () => {
    expect((await run({}, true)).type).toBe('cancelled')
  })
})
