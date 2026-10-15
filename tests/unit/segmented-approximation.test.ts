import { describe, expect, it } from 'vitest'
import { evaluateApproximation, fitApproximationInterval, segmentAt } from '../../src/engine/ephemeris/segmentedApproximation'

describe('segmented approximation scientific contract', () => {
  it('evaluates analytic derivatives and retains the endpoints without extrapolation', () => {
    const segment = { startEt: 100, endEt: 110, coefficients: [[4, 2, 3], [0], [0]], sampledPositionErrorKm: 0, sampledVelocityErrorKmS: 0 }
    expect(evaluateApproximation(segment, 100).position.x).toBe(5)
    expect(evaluateApproximation(segment, 105).position.x).toBe(1)
    expect(evaluateApproximation(segment, 105).velocity.x).toBeCloseTo(.4, 12)
    expect(evaluateApproximation(segment, 110).velocity.x).toBeCloseTo(2.8, 12)
    expect(() => evaluateApproximation(segment, 110.0001)).toThrow('Outside')
    expect(() => evaluateApproximation(segment, NaN)).toThrow('Outside')
  })

  it('adapts fast orbital motion and meets tolerances at independent validation epochs', () => {
    const start = 800_000_000, end = start + 18000, w = 2 * Math.PI / 4000
    const source = (et: number) => ({ position: { x: 10000 * Math.cos(w * (et - start)), y: 10000 * Math.sin(w * (et - start)), z: 100 },
      velocity: { x: -10000 * w * Math.sin(w * (et - start)), y: 10000 * w * Math.cos(w * (et - start)), z: 0 } })
    const segments = fitApproximationInterval(source, start, end, .01, .0001)
    expect(segments.length).toBeGreaterThan(1)
    for (let i = 0; i < 203; i++) {
      const et = start + (end - start) * ((i + .271828) / 203)
      const state = evaluateApproximation(segmentAt(segments, et)!, et), expected = source(et)
      expect(Math.hypot(state.position.x - expected.position.x, state.position.y - expected.position.y)).toBeLessThan(.01)
      expect(Math.hypot(state.velocity.x - expected.velocity.x, state.velocity.y - expected.velocity.y)).toBeLessThan(.0001)
    }
    expect(segmentAt(segments, start - 1)).toBeNull()
    expect(segmentAt(segments, end + 1)).toBeNull()
    expect(segmentAt(segments, segments[1].startEt)).toBe(segments[1])
  })

  it('fails closed when tolerances cannot be reached or source states are invalid', () => {
    const invalid = () => ({ position: { x: NaN, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } })
    expect(() => fitApproximationInterval(invalid, 0, 100, 5, .005)).toThrow('Non-finite')
    expect(() => fitApproximationInterval(invalid, 10, 0, 5, .005)).toThrow(RangeError)
  })
})
