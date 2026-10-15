import { expect, it } from 'vitest'
import { propagateTwoBody } from '../../src/engine/ephemeris/twoBodyForecast'
import { propagatePeriapsisConic } from '../../src/engine/ephemeris/conicPeriapsis'

it('preserves circular states over decades and reverses propagation', () => {
  const seed = { position: { x: 7000, y: 0, z: 0 }, velocity: { x: 0, y: Math.sqrt(398600 / 7000), z: 0 } }
  for (const time of [60, -60, 51 * 365.25 * 86400, -51 * 365.25 * 86400]) {
    const state = propagateTwoBody(seed, 398600, time)
    expect(Math.hypot(...Object.values(state.position))).toBeCloseTo(7000, 7)
    const restored = propagateTwoBody(state, 398600, -time)
    expect(Math.hypot(restored.position.x - 7000, restored.position.y, restored.position.z)).toBeLessThan(time > 1e8 || time < -1e8 ? .01 : 1e-7)
  }
})

it('matches the independent periapsis propagator for elliptic, near-parabolic and hyperbolic rotated seeds', () => {
  for (const eccentricity of [.2, .999999, 1, 1.5]) {
    const conic = { periapsisKm: 50000, eccentricity, gmKm3PerSecond2: 398600,
      inclinationRadians: .4, ascendingNodeRadians: 1.2, argumentOfPeriapsisRadians: .7 }
    const initial = propagatePeriapsisConic(conic, 12345)
    for (const time of [-1e6, -12345, 50, 1e6, 1e9]) {
      const expected = propagatePeriapsisConic(conic, 12345 + time)
      const actual = propagateTwoBody({ position: initial.positionKm, velocity: initial.velocityKmPerSecond }, conic.gmKm3PerSecond2, time)
      const distance = Math.hypot(...(['x', 'y', 'z'] as const).map(axis => actual.position[axis] - expected.positionKm[axis]))
      expect(distance / Math.max(1, Math.hypot(...Object.values(expected.positionKm)))).toBeLessThan(1e-8)
    }
  }
})

it('rejects invalid forecasts rather than publishing a nonfinite state', () => {
  expect(() => propagateTwoBody({ position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }, 1, 1)).toThrow()
  expect(() => propagateTwoBody({ position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 1, z: 0 } }, 0, 1)).toThrow()
})
