import { apparentPosition, type ApparentMode, type BarycentricState } from './apparent'
import { stateToOsculatingElements, type OsculatingElements } from './osculating'
import type { Vector3 } from '../../types'
import { AU_IN_KM, SECONDS_PER_DAY } from '../units'

export type ObservationReferenceFrame = 'eclipj2000' | 'j2000-equatorial' | 'resolver-defined'
export type StateResolver = (bodyId: string, julianDay: number) => BarycentricState | null
export interface ParentRelativeObservationOptions {
  targetId: string
  parentId: string
  observerId: string
  julianDay: number
  gmAU3PerDay2: number
  resolve: StateResolver
  referenceFrame?: ObservationReferenceFrame
  apparentMode?: ApparentMode
}
export interface ParentRelativeObservation {
  referenceFrame: ObservationReferenceFrame
  epochJulianDay: number
  centerId: string
  state: { positionAU: Vector3; velocityAUPerDay: Vector3 }
  osculatingElements: OsculatingElements | null
  apparent: { positionKm: Vector3; lightTimeSeconds: number; emissionJulianDay: number; mode: ApparentMode; converged: boolean }
  assumptions: readonly string[]
}
const sub = (a: readonly [number, number, number], b: readonly [number, number, number]): Vector3 => ({ x: a[0] - b[0], y: a[1] - b[1], z: a[2] - b[2] })
const scale = (v: Vector3, factor: number): Vector3 => ({ x: v.x * factor, y: v.y * factor, z: v.z * factor })
const toVector = (v: readonly number[]): Vector3 => ({ x: v[0], y: v[1], z: v[2] })

/** Build truthful inspector/export data from barycentric callbacks without assuming a propagation model. */
export function deriveParentRelativeObservation(options: ParentRelativeObservationOptions): ParentRelativeObservation | null {
  const { targetId, parentId, observerId, julianDay, gmAU3PerDay2, resolve } = options
  if (!Number.isFinite(julianDay) || !Number.isFinite(gmAU3PerDay2) || gmAU3PerDay2 <= 0) throw new RangeError('Invalid observation epoch or gravitational parameter')
  const target = resolve(targetId, julianDay), parent = resolve(parentId, julianDay), observer = resolve(observerId, julianDay)
  if (!target || !parent || !observer) return null
  const positionAU = scale(sub(target.position, parent.position), 1 / AU_IN_KM)
  const velocityAUPerDay = scale(sub(target.velocity, parent.velocity), SECONDS_PER_DAY / AU_IN_KM)
  const mode = options.apparentMode ?? 'light-time+stellar-aberration'
  const required = (id: string, epoch: number) => {
    const state = resolve(id, epoch)
    if (!state) throw new RangeError(`No state available for ${id} at JD ${epoch}`)
    return state
  }
  const apparent = apparentPosition({ target: jd => required(targetId, jd), observer: jd => required(observerId, jd), julianDay, mode })
  return {
    referenceFrame: options.referenceFrame ?? 'resolver-defined', epochJulianDay: julianDay, centerId: parentId,
    state: { positionAU, velocityAUPerDay },
    osculatingElements: stateToOsculatingElements(positionAU, velocityAUPerDay, gmAU3PerDay2),
    apparent: { positionKm: toVector(apparent.position), lightTimeSeconds: apparent.lightTimeSeconds, emissionJulianDay: apparent.emissionJulianDay, mode: apparent.mode, converged: apparent.converged },
    assumptions: [
      'Parent-relative elements are an instantaneous two-body osculating snapshot in the resolver reference frame.',
      'Apparent position is observer-relative barycentric reception geometry; it is not parent-relative orbital state.',
      'State units are converted from km and km/s to AU and AU/day only for osculating elements.',
      'No gravitational light deflection or additional force correction is applied.',
    ],
  }
}
