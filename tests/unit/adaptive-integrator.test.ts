import { describe, expect, it } from 'vitest'
import { integrateAdaptive, type IntegrationOptions } from '../../src/engine/dynamics/adaptiveIntegrator'

const settings = (overrides: Partial<IntegrationOptions> = {}): IntegrationOptions => ({
  initial: [1], duration: 1, derivative: (_t, y, out) => { out[0] = y[0] },
  absoluteTolerance: [1e-12], relativeTolerance: 1e-11, initialStep: 1, maxStep: 1,
  maxAttempts: 10000, ...overrides,
})

describe('bounded adaptive integration', () => {
  it('rejects an oversized step, reaches the endpoint, and preserves input', async () => {
    const initial = [1], result = await integrateAdaptive(settings({ initial }))
    expect(result.state[0]).toBeCloseTo(Math.E, 10)
    expect(result.elapsed).toBe(1)
    expect(result.rejected).toBeGreaterThan(0)
    expect(result.maxAcceptedErrorRatio).toBeLessThanOrEqual(1)
    expect(result.evaluations).toBe(1 + 6 * result.attempts)
    expect(initial).toEqual([1])
  })
  it('integrates a time-dependent polynomial backwards', async () => {
    const result = await integrateAdaptive(settings({ initial: [0], duration: -3,
      derivative: (t, _y, out) => { out[0] = 3 * t * t } }))
    expect(result.state[0]).toBeCloseTo(-27, 12)
    expect(result.elapsed).toBe(-3)
  })
  it('controls each differently scaled component over a harmonic period', async () => {
    const result = await integrateAdaptive(settings({ initial: [1e8, 0, 1e-8, 0], duration: 2 * Math.PI,
      absoluteTolerance: [1e-4, 1e-4, 1e-20, 1e-20],
      derivative: (_t, y, out) => { out[0] = y[1]; out[1] = -y[0]; out[2] = y[3]; out[3] = -y[2] } }))
    expect(result.state[0] / 1e8).toBeCloseTo(1, 10)
    expect(result.state[2] / 1e-8).toBeCloseTo(1, 10)
    expect(Math.abs(result.state[3] / 1e-8)).toBeLessThan(1e-10)
  })
  it('fails rather than returning a partial trajectory on budget exhaustion', async () => {
    await expect(integrateAdaptive(settings({ maxAttempts: 1 }))).rejects.toThrow('attempt budget')
  })
  it('yields during long work and responds to cancellation', async () => {
    const controller = new AbortController()
    let yields = 0
    await expect(integrateAdaptive(settings({ maxStep: .001, signal: controller.signal,
      yieldControl: async () => { yields++; controller.abort() } }))).rejects.toMatchObject({ name: 'AbortError' })
    expect(yields).toBe(1)
  })
  it('rejects uninitialized derivatives and invalid settings', async () => {
    await expect(integrateAdaptive(settings({ derivative: () => {} }))).rejects.toThrow('every component')
    await expect(integrateAdaptive(settings({ absoluteTolerance: [0] }))).rejects.toThrow()
    await expect(integrateAdaptive(settings({ relativeTolerance: 1e-18 }))).rejects.toThrow()
    await expect(integrateAdaptive(settings({ initial: [Infinity] }))).rejects.toThrow()
  })
  it('returns a zero-length interval without evaluating a force', async () => {
    const result = await integrateAdaptive(settings({ duration: 0, derivative: () => { throw new Error('unexpected') } }))
    expect(result.evaluations).toBe(0)
    expect(result.state[0]).toBe(1)
    expect(result.smallestAcceptedStep).toBeNull()
  })
  it('observes accepted nodes only and isolates observer mutations', async () => {
    const times: number[] = []
    const result = await integrateAdaptive(settings({ onAcceptedStep: (time, state) => { times.push(time); state.fill(NaN) } }))
    expect(times).toHaveLength(result.accepted)
    expect(result.rejected).toBeGreaterThan(0)
    expect(times[times.length-1]).toBe(1)
    expect(times.every((time, i) => i === 0 || time > times[i-1])).toBe(true)
    expect(result.state[0]).toBeCloseTo(Math.E, 10)
  })
})
