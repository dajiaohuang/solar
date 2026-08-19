import { describe, expect, it } from 'vitest'
import { extremumJulianDay, findSampledExtrema, refineBracketedExtremum } from '../../src/engine/events/sampledExtrema'

describe('sampled astronomical event extrema', () => {
  it('never labels a time-window endpoint as an event', () => {
    expect(findSampledExtrema([1, 2, 3, 4], 'minimum')).toEqual([])
    expect(findSampledExtrema([4, 3, 2, 1], 'maximum')).toEqual([])
  })

  it('requires a strict local extremum rather than a flat sampled track', () => {
    expect(findSampledExtrema([2, 2, 2], 'minimum')).toEqual([])
    expect(findSampledExtrema([2, 2, 2], 'maximum')).toEqual([])
  })

  it('refines local event time and value with a three-point parabola', () => {
    const [minimum] = findSampledExtrema([4, 2, 3], 'minimum')
    expect(minimum.sampleIndex).toBe(1)
    expect(minimum.sampleOffset).toBeCloseTo(1 / 6, 12)
    expect(minimum.value).toBeCloseTo(47 / 24, 12)
    expect(extremumJulianDay([100, 101, 102], minimum)).toBeCloseTo(101 + 1 / 6, 12)

    const [maximum] = findSampledExtrema([1, 4, 2], 'maximum')
    expect(maximum.value).toBeGreaterThan(4)
    expect(extremumJulianDay([100, 101, 102], maximum)).toBeGreaterThan(101)
  })

  it('re-evaluates the model while refining a coarse candidate bracket', () => {
    let evaluations = 0
    const refined = refineBracketedExtremum(100, 104, 'minimum', (julianDay) => {
      evaluations += 1
      return (julianDay - 101.25) ** 2 + 3
    })
    expect(refined.julianDay).toBeCloseTo(101.25, 3)
    expect(refined.value).toBeCloseTo(3, 5)
    expect(refined.numericalRefinementHalfWidthDays).toBeLessThan(0.001)
    expect(evaluations).toBeGreaterThan(10)
  })

  it('collapses a sampled plateau into one physical extremum candidate', () => {
    const extrema = findSampledExtrema([4, 2, 2, 4], 'minimum')
    expect(extrema).toHaveLength(1)
    expect(extrema[0].sampleIndex).toBe(1)
  })
})
