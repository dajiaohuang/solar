import { afterEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cleanup: undefined as (() => void) | undefined }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => () => void) => { hooks.cleanup = effect() },
  useState: (value: unknown) => {
    const index = hooks.values.length
    hooks.values.push(value)
    return [value, (next: unknown) => { hooks.values[index] = next }]
  },
}))
vi.mock('../../src/engine/events/eventResultBinding', () => ({ assertEventResultBinding: vi.fn() }))
import { useConjunctionWorker, type RunEventAnalysisParams } from '../../src/hooks/useConjunctionWorker'

class ControlledWorker {
  static instances: ControlledWorker[] = []
  onmessage?: (event: { data: unknown }) => void
  requestId = 0
  constructor() { ControlledWorker.instances.push(this) }
  postMessage(message: { requestId: number }) { this.requestId = message.requestId }
  terminate() { /* A queued callback can still be invoked by this test. */ }
  deliver(events: unknown[]) { this.onmessage?.({ data: { requestId: this.requestId, type: 'result', events } }) }
}
afterEach(() => { hooks.cleanup?.(); hooks.values = []; ControlledWorker.instances = []; vi.unstubAllGlobals() })

describe('event worker publication ownership', () => {
  it('prevents a superseded worker from replacing a newer cached result', () => {
    vi.stubGlobal('Worker', ControlledWorker)
    const api = useConjunctionWorker()
    const earth: RunEventAnalysisParams['bodies'][number] = { id: 'earth', name: 'Earth', kind: 'planet', color: '#fff', size: 1,
      source: 'custom', naifId: 399, orbit: { model: 'keplerian', epochJd: 2451545, semiMajorAxisAU: 1, eccentricity: .01,
        inclinationDeg: 0, ascendingNodeDeg: 0, argPeriapsisDeg: 0, meanAnomalyDeg: 0, meanMotionDegPerDay: .9856 } }
    const first: RunEventAnalysisParams = { bodies: [earth], resolutionBodies: [earth], referenceId: 'sun', centerJulianDay: 2460000,
      windowDays: 1, thresholdAU: .1, eventKinds: ['perihelion'] }
    api.run(first)
    ControlledWorker.instances[0].deliver([{ id: 'verified-A' }])
    api.run({ ...first, centerJulianDay: first.centerJulianDay + 1 })
    const old = ControlledWorker.instances[1]
    api.run(first)
    expect(hooks.values[0]).toEqual([{ id: 'verified-A' }])
    old.deliver([{ id: 'stale-B' }])
    expect(hooks.values[0]).toEqual([{ id: 'verified-A' }])
    api.run({ ...first, centerJulianDay: first.centerJulianDay + 2 })
    const cancelled = ControlledWorker.instances[2]
    api.cancel()
    cancelled.deliver([{ id: 'cancelled' }])
    expect(hooks.values[1]).toBe('cancelled')
    expect(hooks.values[0]).toEqual([])
  })
})
