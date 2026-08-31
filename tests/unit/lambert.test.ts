import { describe, expect, it } from 'vitest'
import { classifyLambertFailure, solveLambertUniversal } from '../../src/engine/mission/lambert'
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
    expect(solution.converged).toBe(true)
    expect(Math.abs(solution.residual)).toBeLessThan(1e-10)
    expect(solution.bracketWidth).toBeGreaterThanOrEqual(0)
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

  it('supports a converged retrograde transfer', () => {
    const circularSpeed = Math.sqrt(SOLAR_GM_AU3_PER_DAY2)
    const solution = solveLambertUniversal({
      departurePositionAU: { x: 1, y: 0, z: 0 },
      arrivalPositionAU: { x: 0, y: 1, z: 0 },
      timeOfFlightDays: 3 * Math.PI / (2 * circularSpeed),
      prograde: false,
    })
    expect(solution.converged).toBe(true)
    expect(Math.abs(solution.residual)).toBeLessThan(1e-10)
  })

  it('keeps long-flight solutions on the zero-revolution branch', () => {
    const solution = solveLambertUniversal({
      departurePositionAU: { x: 1, y: 0, z: 0 },
      arrivalPositionAU: { x: 0, y: 1, z: 0 },
      timeOfFlightDays: 800,
    })

    expect(solution.departureVelocityAUPerDay.x).toBeCloseTo(0.0178149336448, 10)
    expect(solution.departureVelocityAUPerDay.y).toBeCloseTo(0.0104640373391, 10)
    expect(solution.departureVelocityAUPerDay.z).toBe(0)
    expect(solution.converged).toBe(true)
    expect(Math.abs(solution.residual)).toBeLessThan(1e-10)
    expect(solution.bracketWidth).toBeLessThan(4 * Math.PI ** 2)
  })

  it('never returns an unconverged result for extreme time-of-flight cases', () => {
    for (const timeOfFlightDays of [0.01, 20_000]) {
      try {
        const solution = solveLambertUniversal({
          departurePositionAU: { x: 1, y: 0, z: 0.05 },
          arrivalPositionAU: { x: 0, y: 1.4, z: -0.1 },
          timeOfFlightDays,
        })
        expect(solution.converged).toBe(true)
        expect(Math.abs(solution.residual)).toBeLessThan(1e-10)
      } catch (error) {
        expect(['no-solution', 'non-convergence']).toContain(classifyLambertFailure(error))
      }
    }
  })

  it('classifies singular geometry and an exhausted iteration budget', () => {
    let singular: unknown
    try {
      solveLambertUniversal({
        departurePositionAU: { x: 1, y: 0, z: 0 },
        arrivalPositionAU: { x: 2, y: 0, z: 0 },
        timeOfFlightDays: 100,
      })
    } catch (error) { singular = error }
    expect(classifyLambertFailure(singular)).toBe('singular-geometry')

    let nonConverged: unknown
    try {
      solveLambertUniversal({
        departurePositionAU: { x: 1, y: 0, z: 0 },
        arrivalPositionAU: { x: 0, y: 1, z: 0 },
        timeOfFlightDays: 100,
        maxIterations: 1,
      })
    } catch (error) { nonConverged = error }
    expect(classifyLambertFailure(nonConverged)).toBe('non-convergence')
  })
})
