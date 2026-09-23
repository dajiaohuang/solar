import { expect, test } from 'vitest'
import { stateToConicDiagnostics } from '../../src/engine/ephemeris/osculating'
import reference from '../fixtures/conic-diagnostics-reference.json'

const diagnostic = (state: number[], gm: number) => stateToConicDiagnostics(
  { x: state[0], y: state[1], z: state[2] }, { x: state[3], y: state[4], z: state[5] }, gm)

for (const row of reference.cases) test(`independent OSCELT diagnostic: ${row.name}`, () => {
  const actual = diagnostic(row.stateKmKmPerSecond, row.gmKm3PerSecond2)!
  expect(actual).not.toBeNull()
  expect(actual.eccentricity).toBeCloseTo(row.eccentricity, 13)
  expect(actual.inclinationDeg).toBeCloseTo(row.inclinationDeg, 11)
  expect(Math.abs(actual.periapsisKm/row.periapsisKm-1)).toBeLessThan(1e-13)
  expect(Math.abs(actual.reciprocalSemiMajorAxisPerKm/row.reciprocalSemiMajorAxisPerKm-1)).toBeLessThan(1e-13)
  expect(actual.semiMajorAxisKm! * actual.reciprocalSemiMajorAxisPerKm).toBeCloseTo(1, 14)
})

test('parabolic and radial degeneracies do not invent finite axes or orbital planes', () => {
  const parabolic = diagnostic([1, 0, 0, 0, Math.sqrt(2), 0], 1)!
  expect(parabolic.nearParabolic).toBe(true)
  expect(parabolic.semiMajorAxisKm).toBeNull()
  expect(parabolic.periapsisKm).toBeCloseTo(1, 14)
  const radial = diagnostic([1, 0, 0, 1, 0, 0], 1)!
  expect(radial.inclinationDeg).toBeNull()
  expect(radial.periapsisKm).toBe(0)
  expect(radial.nearParabolic).toBe(false)
  expect(diagnostic([1, 0, 0, 0, 0, 0], 1)!.inclinationDeg).toBeNull()
})

test('unit rescaling preserves dimensionless diagnostics and invalid data is absent', () => {
  const state = reference.cases[2].stateKmKmPerSecond, gm = reference.cases[2].gmKm3PerSecond2
  const expected = diagnostic(state, gm)!
  for (const scale of [1e-6, 1e6]) {
    const actual = diagnostic(state.map(value => value*scale), gm*scale**3)!
    expect(actual.eccentricity).toBeCloseTo(expected.eccentricity, 12)
    expect(actual.inclinationDeg).toBeCloseTo(expected.inclinationDeg!, 11)
    expect(actual.periapsisKm/scale).toBeCloseTo(expected.periapsisKm, 5)
  }
  expect(diagnostic([0, 0, 0, 1, 0, 0], gm)).toBeNull()
  expect(diagnostic([1, 0, 0, NaN, 0, 0], gm)).toBeNull()
  expect(diagnostic(state, -1)).toBeNull()
})
