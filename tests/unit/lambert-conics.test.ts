import { describe, expect, it } from 'vitest'
import { solveLambertUniversal } from '../../src/engine/mission/lambert'
import { SOLAR_GM_AU3_PER_DAY2 } from '../../src/engine/units'

// Independent forward conic construction: r=p/(1+e cos nu), perifocal
// velocity sqrt(mu/p)*[-sin nu,e+cos nu], and M=e sinh H-H for e>1.
// These endpoints and flight times do not use the Lambert/Stumpff algorithm.
describe('Lambert solutions against analytic hyperbolic arcs', () => {
  it.each([
    { eccentricity: 1.5, anomalyDegrees: 130, p: 1 },
    { eccentricity: 100, anomalyDegrees: 45, p: 1 },
    { eccentricity: 1.5, anomalyDegrees: 130, p: .0001 },
  ])('recovers the forward conic for $eccentricity / $anomalyDegrees / $p', ({ eccentricity: e, anomalyDegrees, p }) => {
    const nu = anomalyDegrees * Math.PI / 180
    const radius = p / (1 + e * Math.cos(nu))
    const a = p / (e * e - 1)
    const h = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2))
    const timeOfFlightDays = 2 * (e * Math.sinh(h) - h) * Math.sqrt(a ** 3 / SOLAR_GM_AU3_PER_DAY2)
    const solution = solveLambertUniversal({
      departurePositionAU: { x: radius * Math.cos(nu), y: -radius * Math.sin(nu), z: 0 },
      arrivalPositionAU: { x: radius * Math.cos(nu), y: radius * Math.sin(nu), z: 0 },
      timeOfFlightDays,
    })
    const speed = Math.sqrt(SOLAR_GM_AU3_PER_DAY2 / p)
    expect(solution.departureVelocityAUPerDay.x / speed).toBeCloseTo(Math.sin(nu), 9)
    expect(solution.departureVelocityAUPerDay.y / speed).toBeCloseTo(e + Math.cos(nu), 9)
    expect(solution.arrivalVelocityAUPerDay.x / speed).toBeCloseTo(-Math.sin(nu), 9)
    expect(solution.arrivalVelocityAUPerDay.y / speed).toBeCloseTo(e + Math.cos(nu), 9)
  })
})
