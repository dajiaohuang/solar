import type { Vector3 } from '../../types'

export interface OsculatingElements {
  semiMajorAxisAU: number
  eccentricity: number
  inclinationDeg: number
  ascendingNodeDeg: number
  argPeriapsisDeg: number
  meanAnomalyDeg: number
  meanMotionDegPerDay: number
}

const EPS = 1e-12
const deg = 180 / Math.PI
const dot = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vector3, b: Vector3): Vector3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const magnitude = (v: Vector3) => Math.hypot(v.x, v.y, v.z)
const angle = (value: number) => ((value % 360) + 360) % 360

/**
 * Derive instantaneous two-body osculating elements from an AU/AU-day state.
 * This is a snapshot diagnostic: it does not assert that a perturbed body will
 * follow these elements under future propagation.
 * Standard relations follow NAIF OSCELT and JPL orbital-mechanics references.
 */
export function stateToOsculatingElements(positionAU: Vector3, velocityAUPerDay: Vector3, gmAU3PerDay2: number): OsculatingElements | null {
  const values = [positionAU.x, positionAU.y, positionAU.z, velocityAUPerDay.x, velocityAUPerDay.y, velocityAUPerDay.z, gmAU3PerDay2]
  if (values.some(value => !Number.isFinite(value)) || gmAU3PerDay2 <= 0) return null
  const radius = magnitude(positionAU)
  if (radius <= EPS) return null
  const speed2 = dot(velocityAUPerDay, velocityAUPerDay)
  const h = cross(positionAU, velocityAUPerDay)
  const hMag = magnitude(h)
  if (hMag <= EPS || !Number.isFinite(speed2)) return null
  const energy = speed2 / 2 - gmAU3PerDay2 / radius
  if (!(energy < 0) || !Number.isFinite(energy)) return null
  const semiMajorAxisAU = -gmAU3PerDay2 / (2 * energy)
  const eVector = {
    x: ((speed2 - gmAU3PerDay2 / radius) * positionAU.x - dot(positionAU, velocityAUPerDay) * velocityAUPerDay.x) / gmAU3PerDay2,
    y: ((speed2 - gmAU3PerDay2 / radius) * positionAU.y - dot(positionAU, velocityAUPerDay) * velocityAUPerDay.y) / gmAU3PerDay2,
    z: ((speed2 - gmAU3PerDay2 / radius) * positionAU.z - dot(positionAU, velocityAUPerDay) * velocityAUPerDay.z) / gmAU3PerDay2,
  }
  const eccentricity = magnitude(eVector)
  if (!Number.isFinite(eccentricity) || eccentricity >= 1 - EPS) return null
  const inclination = Math.atan2(Math.hypot(h.x, h.y), h.z)
  const node = { x: -h.y, y: h.x, z: 0 }
  const nodeMag = magnitude(node)
  const ascendingNodeDeg = nodeMag > EPS ? angle(Math.atan2(node.y, node.x) * deg) : 0
  let argPeriapsisDeg = 0
  if (eccentricity > EPS) {
    argPeriapsisDeg = nodeMag > EPS
      ? angle(Math.atan2(dot(cross(node, eVector), h) / hMag, dot(node, eVector)) * deg)
      : angle(Math.atan2(h.z < 0 ? -eVector.y : eVector.y, eVector.x) * deg)
  }
  const hUnit = { x: h.x / hMag, y: h.y / hMag, z: h.z / hMag }
  let trueAnomaly: number
  if (eccentricity > EPS) {
    trueAnomaly = Math.atan2(dot(cross(eVector, positionAU), h) / (hMag * eccentricity * radius), dot(eVector, positionAU) / (eccentricity * radius))
  } else if (nodeMag > EPS) {
    trueAnomaly = Math.atan2(dot(positionAU, cross(hUnit, { x: node.x / nodeMag, y: node.y / nodeMag, z: 0 })), dot(positionAU, { x: node.x / nodeMag, y: node.y / nodeMag, z: 0 }))
  } else {
    trueAnomaly = Math.atan2(h.z < 0 ? -positionAU.y : positionAU.y, positionAU.x)
  }
  const eccentricAnomaly = 2 * Math.atan2(Math.sqrt(1 - eccentricity) * Math.sin(trueAnomaly / 2), Math.sqrt(1 + eccentricity) * Math.cos(trueAnomaly / 2))
  const meanAnomaly = eccentricity > EPS ? eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) : trueAnomaly
  const meanMotionDegPerDay = Math.sqrt(gmAU3PerDay2 / semiMajorAxisAU ** 3) * deg
  return { semiMajorAxisAU, eccentricity, inclinationDeg: inclination * deg, ascendingNodeDeg, argPeriapsisDeg, meanAnomalyDeg: angle(meanAnomaly * deg), meanMotionDegPerDay }
}
