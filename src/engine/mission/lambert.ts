import {
  createBodyPositionResolver,
  createBodyVelocityResolver,
  crossVector3,
  dotVector3,
  scaleVector3,
  subtractVector3,
  vector3Magnitude,
} from '../../lib/ephemeris'
import type { BodyId, CelestialBody, Vector3 } from '../../types'
import { SOLAR_GM_AU3_PER_DAY2, auPerDayToKmPerSecond } from '../units'

const FIRST_POSITIVE_STUMPFF_SINGULARITY_Z = 4 * Math.PI ** 2
// Keep the zero-revolution search strictly on the continuous side of C(z) = 0.
const ZERO_REVOLUTION_UPPER_Z = FIRST_POSITIVE_STUMPFF_SINGULARITY_Z * (1 - 1e-12)

export type LambertSolution = {
  model: 'lambert-universal-variable'
  centralBody: 'Sun'
  timeOfFlightDays: number
  departureVelocityAUPerDay: Vector3
  arrivalVelocityAUPerDay: Vector3
  departureVInfinityKmS: number
  arrivalVInfinityKmS: number
  c3Km2S2: number
  prograde: boolean
  iterations: number
  residual: number
  bracketWidth: number
  converged: boolean
}

export type LambertFailureCode = 'invalid-input' | 'singular-geometry' | 'no-solution' | 'non-convergence' | 'singular-coefficient' | 'unknown'

export class LambertError extends RangeError {
  readonly code: Exclude<LambertFailureCode, 'unknown'>

  constructor(code: Exclude<LambertFailureCode, 'unknown'>, message: string) {
    super(message)
    this.name = 'LambertError'
    this.code = code
  }
}

export function classifyLambertFailure(error: unknown): LambertFailureCode {
  return error instanceof LambertError ? error.code : 'unknown'
}

function stumpffC(z: number) {
  if (z > 1e-8) {
    const root = Math.sqrt(z)
    return 2 * Math.sin(root / 2) ** 2 / z
  }
  if (z < -1e-8) {
    const root = Math.sqrt(-z)
    return (Math.cosh(root) - 1) / -z
  }
  return 1 / 2 - z / 24 + z * z / 720
}

function stumpffS(z: number) {
  if (z > 1e-8) {
    const root = Math.sqrt(z)
    return (root - Math.sin(root)) / (root ** 3)
  }
  if (z < -1e-8) {
    const root = Math.sqrt(-z)
    return (Math.sinh(root) - root) / (root ** 3)
  }
  return 1 / 6 - z / 120 + z * z / 5040
}

function addScaled(a: Vector3, b: Vector3, bScale: number): Vector3 {
  return { x: a.x + b.x * bScale, y: a.y + b.y * bScale, z: a.z + b.z * bScale }
}

export function solveLambertUniversal(params: {
  departurePositionAU: Vector3
  arrivalPositionAU: Vector3
  timeOfFlightDays: number
  prograde?: boolean
  gravitationalParameter?: number
  maxIterations?: number
}): Omit<LambertSolution, 'departureVInfinityKmS' | 'arrivalVInfinityKmS' | 'c3Km2S2'> {
  const {
    departurePositionAU: r1Vector,
    arrivalPositionAU: r2Vector,
    timeOfFlightDays,
    prograde = true,
    gravitationalParameter = SOLAR_GM_AU3_PER_DAY2,
    maxIterations = 100,
  } = params
  const r1 = vector3Magnitude(r1Vector)
  const r2 = vector3Magnitude(r2Vector)
  if (![r1, r2, timeOfFlightDays, gravitationalParameter].every(Number.isFinite) ||
      r1 <= 0 || r2 <= 0 || timeOfFlightDays <= 0 || gravitationalParameter <= 0 ||
      !Number.isSafeInteger(maxIterations) || maxIterations <= 0 || maxIterations > 1_000) {
    throw new LambertError('invalid-input', 'Lambert inputs require positive radii, time of flight, and gravitational parameter')
  }

  const cosTransfer = Math.max(-1, Math.min(1, dotVector3(r1Vector, r2Vector) / (r1 * r2)))
  const cross = crossVector3(r1Vector, r2Vector)
  let sinTransfer = Math.sqrt(Math.max(0, 1 - cosTransfer * cosTransfer))
  if ((prograde && cross.z < 0) || (!prograde && cross.z >= 0)) {
    sinTransfer = -sinTransfer
  }
  const denominator = 1 - cosTransfer
  if (Math.abs(sinTransfer) < 1e-12 || denominator < 1e-12) {
    throw new LambertError('singular-geometry', 'Lambert geometry is singular for collinear endpoint vectors')
  }

  const aParameter = sinTransfer * Math.sqrt(r1 * r2 / denominator)
  const target = Math.sqrt(gravitationalParameter) * timeOfFlightDays

  const evaluate = (z: number) => {
    const c = stumpffC(z)
    const s = stumpffS(z)
    if (c <= 0) {
      return { residual: Number.NaN, y: Number.NaN }
    }
    const y = r1 + r2 + aParameter * (z * s - 1) / Math.sqrt(c)
    if (y < 0) {
      return { residual: Number.NaN, y }
    }
    const x = Math.sqrt(y / c)
    return {
      residual: x ** 3 * s + aParameter * Math.sqrt(y) - target,
      y,
    }
  }

  let lower = -FIRST_POSITIVE_STUMPFF_SINGULARITY_Z
  let upper = ZERO_REVOLUTION_UPPER_Z
  let lowerEval = evaluate(lower)
  const upperEval = evaluate(upper)
  for (let expansion = 0; expansion < 24; expansion += 1) {
    if (Number.isFinite(lowerEval.residual) && Number.isFinite(upperEval.residual) &&
        lowerEval.residual * upperEval.residual <= 0) {
      break
    }
    if (!Number.isFinite(lowerEval.residual) || lowerEval.residual > 0) {
      lower /= 2
      lowerEval = evaluate(lower)
    }
  }

  if (!Number.isFinite(lowerEval.residual) || !Number.isFinite(upperEval.residual) ||
      lowerEval.residual * upperEval.residual > 0) {
    // Scan a broad interval for the first zero-revolution bracket.
    let previousZ = -FIRST_POSITIVE_STUMPFF_SINGULARITY_Z
    let previous = evaluate(previousZ)
    let found = false
    for (let index = 1; index <= 800; index += 1) {
      const z = -FIRST_POSITIVE_STUMPFF_SINGULARITY_Z + index * (
        (ZERO_REVOLUTION_UPPER_Z + FIRST_POSITIVE_STUMPFF_SINGULARITY_Z) / 800
      )
      const current = evaluate(z)
      if (Number.isFinite(previous.residual) && Number.isFinite(current.residual) &&
          previous.residual * current.residual <= 0) {
        lower = previousZ
        upper = z
        lowerEval = previous
        found = true
        break
      }
      previousZ = z
      previous = current
    }
    if (!found) {
      throw new LambertError('no-solution', 'No zero-revolution Lambert solution was found for this geometry and flight time')
    }
  }

  let y = Number.NaN
  let iterations = 0
  let residual = Number.NaN
  let bracketWidth = Math.abs(upper - lower)
  let converged = false
  for (; iterations < maxIterations; iterations += 1) {
    const midpoint = (lower + upper) / 2
    const current = evaluate(midpoint)
    if (!Number.isFinite(current.residual)) {
      lower = midpoint
      continue
    }
    y = current.y
    residual = current.residual
    bracketWidth = Math.abs(upper - lower)
    if (Math.abs(residual) < 1e-10) {
      converged = true
      iterations += 1
      break
    }
    if (current.residual * lowerEval.residual <= 0) {
      upper = midpoint
    } else {
      lower = midpoint
      lowerEval = current
    }
    bracketWidth = Math.abs(upper - lower)
  }

  if (!converged || !Number.isFinite(residual) || !Number.isFinite(y) || y <= 0) {
    throw new LambertError('non-convergence', `Lambert iteration did not converge after ${iterations} iterations (residual ${residual})`)
  }
  const f = 1 - y / r1
  const g = aParameter * Math.sqrt(y / gravitationalParameter)
  const gDot = 1 - y / r2
  if (Math.abs(g) < 1e-12) {
    throw new LambertError('singular-coefficient', 'Lambert solution has a singular Lagrange g coefficient')
  }

  return {
    model: 'lambert-universal-variable',
    centralBody: 'Sun',
    timeOfFlightDays,
    departureVelocityAUPerDay: scaleVector3(addScaled(r2Vector, r1Vector, -f), 1 / g),
    arrivalVelocityAUPerDay: scaleVector3(addScaled(scaleVector3(r2Vector, gDot), r1Vector, -1), 1 / g),
    prograde,
    iterations,
    residual,
    bracketWidth,
    converged,
  }
}

export function solveBodyToBodyLambert(params: {
  departureBodyId: BodyId
  arrivalBodyId: BodyId
  bodiesById: Map<BodyId, CelestialBody>
  departureJulianDay: number
  arrivalJulianDay: number
  prograde?: boolean
}): LambertSolution {
  const {
    departureBodyId,
    arrivalBodyId,
    bodiesById,
    departureJulianDay,
    arrivalJulianDay,
    prograde = true,
  } = params
  const timeOfFlightDays = arrivalJulianDay - departureJulianDay
  const departurePositions = createBodyPositionResolver(bodiesById, departureJulianDay)
  const arrivalPositions = createBodyPositionResolver(bodiesById, arrivalJulianDay)
  const solution = solveLambertUniversal({
    departurePositionAU: departurePositions(departureBodyId),
    arrivalPositionAU: arrivalPositions(arrivalBodyId),
    timeOfFlightDays,
    prograde,
  })
  const departureBodyVelocity = createBodyVelocityResolver(bodiesById, departureJulianDay)(departureBodyId)
  const arrivalBodyVelocity = createBodyVelocityResolver(bodiesById, arrivalJulianDay)(arrivalBodyId)
  const departureVInfinityKmS = auPerDayToKmPerSecond(vector3Magnitude(
    subtractVector3(solution.departureVelocityAUPerDay, departureBodyVelocity),
  ))
  const arrivalVInfinityKmS = auPerDayToKmPerSecond(vector3Magnitude(
    subtractVector3(solution.arrivalVelocityAUPerDay, arrivalBodyVelocity),
  ))

  return {
    ...solution,
    departureVInfinityKmS,
    arrivalVInfinityKmS,
    c3Km2S2: departureVInfinityKmS ** 2,
  }
}

export type PorkchopPoint = {
  departureJulianDay: number
  arrivalJulianDay: number
  departureVInfinityKmS: number
  arrivalVInfinityKmS: number
  totalVInfinityKmS: number
  feasible: boolean
  failureCode?: LambertFailureCode
}

export function computePorkchopGrid(params: {
  departureBodyId: BodyId
  arrivalBodyId: BodyId
  bodiesById: Map<BodyId, CelestialBody>
  departureStartJd: number
  departureSpanDays: number
  minFlightDays: number
  maxFlightDays: number
  columns?: number
  rows?: number
}) {
  const columns = Math.max(2, Math.min(params.columns ?? 24, 60))
  const rows = Math.max(2, Math.min(params.rows ?? 20, 60))
  const points: PorkchopPoint[] = []
  for (let row = 0; row < rows; row += 1) {
    const flightDays = params.minFlightDays + row / (rows - 1) *
      (params.maxFlightDays - params.minFlightDays)
    for (let column = 0; column < columns; column += 1) {
      const departureJulianDay = params.departureStartJd + column / (columns - 1) * params.departureSpanDays
      const arrivalJulianDay = departureJulianDay + flightDays
      try {
        const solution = solveBodyToBodyLambert({
          departureBodyId: params.departureBodyId,
          arrivalBodyId: params.arrivalBodyId,
          bodiesById: params.bodiesById,
          departureJulianDay,
          arrivalJulianDay,
        })
        points.push({
          departureJulianDay,
          arrivalJulianDay,
          departureVInfinityKmS: solution.departureVInfinityKmS,
          arrivalVInfinityKmS: solution.arrivalVInfinityKmS,
          totalVInfinityKmS: solution.departureVInfinityKmS + solution.arrivalVInfinityKmS,
          feasible: true,
        })
      } catch (error) {
        points.push({
          departureJulianDay,
          arrivalJulianDay,
          departureVInfinityKmS: Number.NaN,
          arrivalVInfinityKmS: Number.NaN,
          totalVInfinityKmS: Number.NaN,
          feasible: false,
          failureCode: classifyLambertFailure(error),
        })
      }
    }
  }
  return { columns, rows, points }
}
