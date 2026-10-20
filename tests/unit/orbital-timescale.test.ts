import { expect, test } from 'vitest'
import { orbitalTimescaleComparison, stateToConicDiagnostics } from '../../src/engine/ephemeris/osculating'

test('elliptic period and apoapsis follow the two-body energy relation', () => {
  const gm = 398600.4418, axis = 10000
  for (const eccentricity of [0, 0.3, 0.9]) {
    const radius = axis * (1 - eccentricity)
    const speed = Math.sqrt(gm * (2 / radius - 1 / axis))
    const result = stateToConicDiagnostics({ x: radius, y: 0, z: 0 }, { x: 0, y: speed, z: 0 }, gm)!
    expect(result.orbitalPeriodSeconds! / (2 * Math.PI * Math.sqrt(axis ** 3 / gm))).toBeCloseTo(1, 12)
    expect(result.apoapsisKm! / (axis * (1 + eccentricity))).toBeCloseTo(1, 12)
  }
})

test('parabolic, hyperbolic and radial states do not invent a period or apoapsis', () => {
  for (const velocity of [{ x: 0, y: Math.SQRT2, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 0.5, y: 0, z: 0 }]) {
    const result = stateToConicDiagnostics({ x: 1, y: 0, z: 0 }, velocity, 1)!
    expect(result.orbitalPeriodSeconds).toBeNull()
    expect(result.apoapsisKm).toBeNull()
  }
})

test('duration comparison is unsigned, explicit about absent periods and rejects invalid periods', () => {
  expect(orbitalTimescaleComparison(-30, 10).absoluteDurationInInitialPeriods).toBe(3)
  expect(orbitalTimescaleComparison(0, 10).absoluteDurationInInitialPeriods).toBe(0)
  expect(orbitalTimescaleComparison(30, null).absoluteDurationInInitialPeriods).toBeNull()
  for (const period of [0, -1, NaN, Infinity]) expect(() => orbitalTimescaleComparison(30, period)).toThrow()
})
