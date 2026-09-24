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

/** Instantaneous Newtonian conic diagnostics for km, km/s and km^3/s^2.
 * Includes unbound conics. These are not constants of a perturbed/1PN orbit.
 * Null axes/planes remain undefined rather than receiving a fabricated angle. */
export function stateToConicDiagnostics(positionKm: Vector3, velocityKmPerSecond: Vector3, gmKm3PerSecond2: number) {
  const r = magnitude(positionKm), mu = gmKm3PerSecond2
  if (![positionKm.x, positionKm.y, positionKm.z, velocityKmPerSecond.x, velocityKmPerSecond.y, velocityKmPerSecond.z, mu, r].every(Number.isFinite) || !(mu > 0) || !(r > 0)) return null
  const scale = Math.sqrt(mu/r)
  const unit = { x: positionKm.x/r, y: positionKm.y/r, z: positionKm.z/r }
  const velocity = { x: velocityKmPerSecond.x/scale, y: velocityKmPerSecond.y/scale, z: velocityKmPerSecond.z/scale }
  const h = cross(unit, velocity), hNorm = magnitude(h), speed2 = dot(velocity, velocity)
  const vxh = cross(velocity, h), eccentricity = Math.hypot(vxh.x-unit.x, vxh.y-unit.y, vxh.z-unit.z)
  const reciprocalSemiMajorAxisPerKm = (2-speed2)/r
  const periapsisKm = r*(hNorm/(1+eccentricity))*hNorm
  const specificKeplerEnergyKm2PerSecond2 = (speed2/2-1)*(mu/r)
  if (![hNorm, speed2, eccentricity, reciprocalSemiMajorAxisPerKm, periapsisKm, specificKeplerEnergyKm2PerSecond2].every(Number.isFinite)) return null
  const axis = 1/reciprocalSemiMajorAxisPerKm
  const nearParabolic = Math.abs(2-speed2) <= 32*Number.EPSILON*Math.max(2, speed2)
  const definedPlane = hNorm > 0 && hNorm/Math.sqrt(speed2) > EPS
  const elliptic = definedPlane && !nearParabolic && Number.isFinite(axis) && axis > 0 && eccentricity < 1
  // Kepler period 2*pi*sqrt(a^3/mu), ordered without cubing a. NAIF
  // OSCLTX defines period only for ellipses; null is our undefined sentinel.
  const period = elliptic ? 2*Math.PI*(Math.sqrt(axis)*(axis/Math.sqrt(mu))) : NaN
  const apoapsis = elliptic ? axis*(1+eccentricity) : NaN
  return { eccentricity, reciprocalSemiMajorAxisPerKm, nearParabolic, semiMajorAxisKm: !nearParabolic && Number.isFinite(axis) ? axis : null, periapsisKm,
    inclinationDeg: definedPlane ? Math.atan2(Math.hypot(h.x, h.y), h.z)*deg : null,
    apoapsisKm: Number.isFinite(apoapsis) && apoapsis > 0 ? apoapsis : null,
    orbitalPeriodSeconds: Number.isFinite(period) && period > 0 ? period : null,
    specificKeplerEnergyKm2PerSecond2 }
}

/** Reproducible duration comparison, not an observed revolution count. */
export function orbitalTimescaleComparison(elapsedTdbSeconds: number, initialPeriodSeconds: number | null) {
  if (!Number.isFinite(elapsedTdbSeconds) || initialPeriodSeconds !== null &&
      (!Number.isFinite(initialPeriodSeconds) || initialPeriodSeconds <= 0)) throw new RangeError('Invalid orbital timescale inputs')
  const ratio = initialPeriodSeconds === null ? NaN : Math.abs(elapsedTdbSeconds)/initialPeriodSeconds
  return {
    method: 'absolute-duration-over-initial-osculating-period-v1',
    elapsedTdbSeconds, initialPeriodSeconds,
    absoluteDurationInInitialPeriods: Number.isFinite(ratio) && (ratio > 0 || elapsedTdbSeconds === 0) ? ratio : null,
    limitation: 'Timescale comparison with the initial instantaneous Newtonian ellipse; not a measured revolution count, resonance classification or long-term stability proof.',
  }
}

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
  if (radius <= 0) return null
  const speed2 = dot(velocityAUPerDay, velocityAUPerDay)
  const h = cross(positionAU, velocityAUPerDay)
  const hMag = magnitude(h)
  if (!(hMag > 0) || !Number.isFinite(hMag) || !Number.isFinite(speed2) ||
      hMag / radius / Math.sqrt(speed2) <= EPS) return null
  const energy = speed2 / 2 - gmAU3PerDay2 / radius
  if (!(energy < 0) || !Number.isFinite(energy)) return null
  const semiMajorAxisAU = -gmAU3PerDay2 / (2 * energy)
  if (!Number.isFinite(semiMajorAxisAU)) return null
  const radialProduct = dot(positionAU, velocityAUPerDay)
  const eVector = {
    x: ((speed2 - gmAU3PerDay2 / radius) * positionAU.x - radialProduct * velocityAUPerDay.x) / gmAU3PerDay2,
    y: ((speed2 - gmAU3PerDay2 / radius) * positionAU.y - radialProduct * velocityAUPerDay.y) / gmAU3PerDay2,
    z: ((speed2 - gmAU3PerDay2 / radius) * positionAU.z - radialProduct * velocityAUPerDay.z) / gmAU3PerDay2,
  }
  const eccentricity = magnitude(eVector)
  if (!Number.isFinite(eccentricity) || eccentricity >= 1 - EPS) return null
  const inclination = Math.atan2(Math.hypot(h.x, h.y), h.z)
  const hUnit = { x: h.x / hMag, y: h.y / hMag, z: h.z / hMag }
  // Equatorial degeneracy is angular, not an AU^2/day magnitude threshold.
  const node = { x: -hUnit.y, y: hUnit.x, z: 0 }
  const nodeMag = magnitude(node)
  const ascendingNodeDeg = nodeMag > EPS ? angle(Math.atan2(node.y, node.x) * deg) : 0
  let argPeriapsisDeg = 0
  if (eccentricity > EPS) {
    argPeriapsisDeg = nodeMag > EPS
      ? angle(Math.atan2(dot(cross(node, eVector), h) / hMag, dot(node, eVector)) * deg)
      : angle(Math.atan2(h.z < 0 ? -eVector.y : eVector.y, eVector.x) * deg)
  }
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
  if (!Number.isFinite(meanMotionDegPerDay) || meanMotionDegPerDay <= 0) return null
  return { semiMajorAxisAU, eccentricity, inclinationDeg: inclination * deg, ascendingNodeDeg, argPeriapsisDeg, meanAnomalyDeg: angle(meanAnomaly * deg), meanMotionDegPerDay }
}
