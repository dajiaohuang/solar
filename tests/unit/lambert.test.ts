import { describe, expect, it } from 'vitest'
import { solveLambertUniversal } from '../../src/engine/mission/lambert'
import { SOLAR_GM_AU3_PER_DAY2 } from '../../src/engine/units'

describe('universal-variable Lambert solver', () => {
  it('recovers a quarter of a circular 1 AU orbit', () => {
    const circularSpeed = Math.sqrt(SOLAR_GM_AU3_PER_DAY2)
    const quarterPeriod = Math.PI / (2 * circularSpeed)
    const solution = solveLambertUniversal({
      departurePositionAU: { x: 1, y: 0, z: 0 },
      arrivalPositionAU: { x: 0, y: 1, z: 0 },
      timeOfFlightDays: quarterPeriod,
    })
    expect(solution.departureVelocityAUPerDay.x).toBeCloseTo(0, 4)
    expect(solution.departureVelocityAUPerDay.y).toBeCloseTo(circularSpeed, 4)
    expect(solution.arrivalVelocityAUPerDay.x).toBeCloseTo(-circularSpeed, 4)
    expect(solution.arrivalVelocityAUPerDay.y).toBeCloseTo(0, 4)
  })
})
