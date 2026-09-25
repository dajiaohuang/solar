import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/jpl-horizons-events.json'
import { majorBodies } from '../../src/data/majorBodies'
import { adaptiveEventSampleCount, eventSamplingPlan, eventSamplingReceipt } from '../../src/engine/events/eventSampling'
import { findSampledExtrema, refineBracketedExtremum } from '../../src/engine/events/sampledExtrema'
import { createBodyPositionResolver, subtractVector3, vector3Magnitude } from '../../src/lib/ephemeris'
import type { CelestialBody } from '../../src/types'

const keplerianBody = (id: string, meanMotionDegPerDay: number, eccentricity: number): CelestialBody => ({
  id, name: id, kind: 'asteroid', color: '#fff', size: 1, source: 'mpcorb',
  orbit: { model: 'keplerian', epochJd: 2_451_545, semiMajorAxisAU: 1, eccentricity,
    inclinationDeg: 0, ascendingNodeDeg: 0, argPeriapsisDeg: 0, meanAnomalyDeg: 0, meanMotionDegPerDay },
})

describe('JPL Horizons event fixture', () => {
  it('handles large body sets without quadratic pair comparisons or spread argument overflow', () => {
    const moon = majorBodies.find(body => body.id === 'moon')!
    expect(eventSamplingPlan(Array(150_000).fill(moon), 365)).toEqual(eventSamplingPlan([moon], 365))
  })

  it('rejects non-finite windows and invalid sample counts before presenting a sampling plan', () => {
    for (const days of [NaN, Infinity, -1]) expect(() => eventSamplingPlan([], days)).toThrow(RangeError)
    for (const count of [NaN, Infinity, 0, 1.5]) expect(() => eventSamplingPlan([], 365, count)).toThrow(RangeError)
  })

  it('reports the actual scan cadence for windows shorter than one hour', () => {
    const windowDays = 1 / 1_440
    const plan = eventSamplingPlan([], windowDays)
    expect(plan.actualSamples).toBe(80)
    expect(plan.maximumResolvablePeriodDays).toBeCloseTo(windowDays * 36 / (plan.actualSamples - 1), 14)
  })

  it('rejects a requested grid whose Julian Day samples collapse to duplicate epochs', () => {
    expect(() => eventSamplingReceipt(2_451_545, 1e-8, 80)).toThrow(/Julian Day numerical resolution/)
    expect(() => eventSamplingReceipt(2_451_545, 1, 721)).toThrow(/sample count/)
  })

  it('keeps the exploratory Earth perihelion within the declared model tolerance', () => {
    const expected = fixture.events[0]
    const bodiesById = new Map(majorBodies.map((body) => [body.id, body]))
    const samples = adaptiveEventSampleCount([bodiesById.get('earth')!], 20)
    const start = expected.julianDayTdb - 10
    const julianDays = Array.from({ length: samples }, (_, index) => start + index / (samples - 1) * 20)
    const distances = julianDays.map((julianDay) => {
      const resolve = createBodyPositionResolver(bodiesById, julianDay)
      return vector3Magnitude(subtractVector3(resolve('earth'), resolve('sun')))
    })
    const candidate = findSampledExtrema(distances, 'minimum')
      .sort((left, right) => Math.abs(julianDays[left.sampleIndex] - expected.julianDayTdb) - Math.abs(julianDays[right.sampleIndex] - expected.julianDayTdb))[0]
    expect(candidate).toBeDefined()
    const refined = refineBracketedExtremum(
      julianDays[candidate.sampleIndex - 1],
      julianDays[candidate.sampleIndex + 1],
      'minimum',
      (julianDay) => {
        const resolve = createBodyPositionResolver(bodiesById, julianDay)
        return vector3Magnitude(subtractVector3(resolve('earth'), resolve('sun')))
      },
    )
    expect(Math.abs(refined.julianDay - expected.julianDayTdb)).toBeLessThan(expected.timeToleranceDays)
    expect(Math.abs(refined.value - expected.distanceAu)).toBeLessThan(expected.distanceToleranceAu)
  })

  it('increases cadence for fast satellite motion', () => {
    const earth = majorBodies.find((body) => body.id === 'earth')!
    const moon = majorBodies.find((body) => body.id === 'moon')!
    expect(adaptiveEventSampleCount([earth, moon], 365)).toBeGreaterThan(adaptiveEventSampleCount([earth], 365))
  })

  it('budgets relative motion and periapsis angular speed for eccentric ellipses', () => {
    const target = keplerianBody('target', 0.25, 0)
    const reference = keplerianBody('reference', 1, 0)
    const windowDays = 1_825
    expect(eventSamplingPlan([target, reference], windowDays).requiredSamples)
      .toBeGreaterThan(eventSamplingPlan([target], windowDays).requiredSamples)

    const eccentric = { ...target, orbit: { ...target.orbit!, eccentricity: 0.9 } }
    const circularPlan = eventSamplingPlan([target], windowDays)
    const eccentricPlan = eventSamplingPlan([eccentric], windowDays)
    expect(eccentricPlan.requiredSamples).toBeGreaterThan(circularPlan.requiredSamples)
    expect(eccentricPlan.actualSamples).toBe(720)
    expect(eccentricPlan.capped).toBe(true)
  })

  it.each(['moon', 'io', 'europa'])('reports a capped five-year window for fast satellite %s', (bodyId) => {
    const body = majorBodies.find((candidate) => candidate.id === bodyId)!
    const plan = eventSamplingPlan([body], 1_825)
    expect(plan.actualSamples).toBe(720)
    expect(plan.requiredSamples).toBeGreaterThan(plan.actualSamples)
    expect(plan.capped).toBe(true)
    expect(plan.maximumResolvablePeriodDays).toBeGreaterThan(80)
  })
})
