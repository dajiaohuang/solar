import { describe, expect, it } from 'vitest'
import { solveLambertUniversal } from '../../src/engine/mission/lambert'
import { SOLAR_GM_AU3_PER_DAY2 } from '../../src/engine/units'
import fixture from '../fixtures/lambert-benchmarks.json'

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

  it('matches the classical three-dimensional Lambert benchmark', () => {
    const benchmark = fixture.cases[0]
    const auKm = 149_597_870.7
    const secondsPerDay = 86_400
    const vector = ([x, y, z]: number[]) => ({ x: x / auKm, y: y / auKm, z: z / auKm })
    const solution = solveLambertUniversal({
      departurePositionAU: vector(benchmark.departurePositionKm),
      arrivalPositionAU: vector(benchmark.arrivalPositionKm),
      timeOfFlightDays: benchmark.timeOfFlightSeconds / secondsPerDay,
      gravitationalParameter: benchmark.gravitationalParameterKm3S2 * secondsPerDay ** 2 / auKm ** 3,
    })
    const toKmS = (value: number) => value * auKm / secondsPerDay
    const departure = Object.values(solution.departureVelocityAUPerDay).map(toKmS)
    const arrival = Object.values(solution.arrivalVelocityAUPerDay).map(toKmS)
    departure.forEach((value, index) => expect(value).toBeCloseTo(benchmark.expectedDepartureVelocityKmS[index], 3))
    arrival.forEach((value, index) => expect(value).toBeCloseTo(benchmark.expectedArrivalVelocityKmS[index], 3))
  })
})
