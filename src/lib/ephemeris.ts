import { J2000_JULIAN_DAY } from './julianDate'
import type {
  BodyId,
  CelestialBody,
  ElementSet,
  KeplerianOrbit,
  OrbitDefinition,
  PlanetaryApproxOrbit,
  Vector3,
} from '../types'

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

export function normalizeDegrees(angle: number) {
  const wrapped = angle % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

function toRadians(angleDeg: number) {
  return angleDeg * DEG_TO_RAD
}

function solveKeplerEquation(meanAnomalyDeg: number, eccentricity: number) {
  let eccentricAnomalyDeg = meanAnomalyDeg + eccentricity * RAD_TO_DEG * Math.sin(toRadians(meanAnomalyDeg))

  for (let iteration = 0; iteration < 15; iteration += 1) {
    const deltaMeanAnomalyDeg =
      meanAnomalyDeg - (eccentricAnomalyDeg - eccentricity * RAD_TO_DEG * Math.sin(toRadians(eccentricAnomalyDeg)))
    const deltaEccentricAnomalyDeg =
      deltaMeanAnomalyDeg / (1 - eccentricity * Math.cos(toRadians(eccentricAnomalyDeg)))

    eccentricAnomalyDeg += deltaEccentricAnomalyDeg

    if (Math.abs(deltaEccentricAnomalyDeg) <= 1e-6) {
      break
    }
  }

  return eccentricAnomalyDeg
}

function getPlanetaryElementsAtJulianDay(orbit: PlanetaryApproxOrbit, julianDay: number) {
  const centuries = (julianDay - J2000_JULIAN_DAY) / 36525
  const applyRate = (base: ElementSet, rates: ElementSet) => ({
    semiMajorAxisAU: base.semiMajorAxisAU + rates.semiMajorAxisAU * centuries,
    eccentricity: base.eccentricity + rates.eccentricity * centuries,
    inclinationDeg: base.inclinationDeg + rates.inclinationDeg * centuries,
    meanLongitudeDeg: base.meanLongitudeDeg + rates.meanLongitudeDeg * centuries,
    longitudeOfPerihelionDeg:
      base.longitudeOfPerihelionDeg + rates.longitudeOfPerihelionDeg * centuries,
    longitudeOfAscendingNodeDeg:
      base.longitudeOfAscendingNodeDeg + rates.longitudeOfAscendingNodeDeg * centuries,
  })

  const elements = applyRate(orbit.base, orbit.rates)
  let meanAnomalyDeg = elements.meanLongitudeDeg - elements.longitudeOfPerihelionDeg

  if (orbit.extraTerms) {
    meanAnomalyDeg +=
      orbit.extraTerms.b * centuries ** 2 +
      orbit.extraTerms.c * Math.cos(toRadians(orbit.extraTerms.f * centuries)) +
      orbit.extraTerms.s * Math.sin(toRadians(orbit.extraTerms.f * centuries))
  }

  return {
    semiMajorAxisAU: elements.semiMajorAxisAU,
    eccentricity: elements.eccentricity,
    inclinationDeg: elements.inclinationDeg,
    ascendingNodeDeg: elements.longitudeOfAscendingNodeDeg,
    argPeriapsisDeg: elements.longitudeOfPerihelionDeg - elements.longitudeOfAscendingNodeDeg,
    meanAnomalyDeg: normalizeDegrees(meanAnomalyDeg),
  }
}

function getKeplerianElementsAtJulianDay(orbit: KeplerianOrbit, julianDay: number) {
  const elapsedDays = julianDay - orbit.epochJd
  const meanAnomalyDeg = orbit.meanAnomalyDeg + orbit.meanMotionDegPerDay * elapsedDays

  return {
    semiMajorAxisAU: orbit.semiMajorAxisAU,
    eccentricity: orbit.eccentricity,
    inclinationDeg: orbit.inclinationDeg,
    ascendingNodeDeg: orbit.ascendingNodeDeg,
    argPeriapsisDeg: orbit.argPeriapsisDeg,
    meanAnomalyDeg: normalizeDegrees(meanAnomalyDeg),
  }
}

function getInstantaneousElements(orbit: OrbitDefinition, julianDay: number) {
  return orbit.model === 'planetaryApprox'
    ? getPlanetaryElementsAtJulianDay(orbit, julianDay)
    : getKeplerianElementsAtJulianDay(orbit, julianDay)
}

export function orbitToHeliocentricVector(orbit: OrbitDefinition, julianDay: number): Vector3 {
  const {
    semiMajorAxisAU,
    eccentricity,
    inclinationDeg,
    ascendingNodeDeg,
    argPeriapsisDeg,
    meanAnomalyDeg,
  } = getInstantaneousElements(orbit, julianDay)

  const eccentricAnomalyDeg = solveKeplerEquation(meanAnomalyDeg, eccentricity)
  const eccentricAnomalyRad = toRadians(eccentricAnomalyDeg)
  const ascendingNodeRad = toRadians(ascendingNodeDeg)
  const inclinationRad = toRadians(inclinationDeg)
  const argPeriapsisRad = toRadians(argPeriapsisDeg)

  const orbitalX = semiMajorAxisAU * (Math.cos(eccentricAnomalyRad) - eccentricity)
  const orbitalY =
    semiMajorAxisAU * Math.sqrt(1 - eccentricity ** 2) * Math.sin(eccentricAnomalyRad)

  return {
    x:
      (Math.cos(argPeriapsisRad) * Math.cos(ascendingNodeRad) -
        Math.sin(argPeriapsisRad) * Math.sin(ascendingNodeRad) * Math.cos(inclinationRad)) *
        orbitalX +
      (-Math.sin(argPeriapsisRad) * Math.cos(ascendingNodeRad) -
        Math.cos(argPeriapsisRad) * Math.sin(ascendingNodeRad) * Math.cos(inclinationRad)) *
        orbitalY,
    y:
      (Math.cos(argPeriapsisRad) * Math.sin(ascendingNodeRad) +
        Math.sin(argPeriapsisRad) * Math.cos(ascendingNodeRad) * Math.cos(inclinationRad)) *
        orbitalX +
      (-Math.sin(argPeriapsisRad) * Math.sin(ascendingNodeRad) +
        Math.cos(argPeriapsisRad) * Math.cos(ascendingNodeRad) * Math.cos(inclinationRad)) *
        orbitalY,
    z:
      Math.sin(argPeriapsisRad) * Math.sin(inclinationRad) * orbitalX +
      Math.cos(argPeriapsisRad) * Math.sin(inclinationRad) * orbitalY,
  }
}

export function addVector3(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function subtractVector3(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function vector3Magnitude(vector: Vector3) {
  return Math.hypot(vector.x, vector.y, vector.z)
}

export function createBodyPositionResolver(bodiesById: Map<BodyId, CelestialBody>, julianDay: number) {
  const cache = new Map<BodyId, Vector3>()

  const resolve = (bodyId: BodyId): Vector3 => {
    const cached = cache.get(bodyId)
    if (cached) {
      return cached
    }

    const body = bodiesById.get(bodyId)
    if (!body) {
      throw new Error(`Unknown body: ${bodyId}`)
    }

    if (!body.orbit) {
      const origin = { x: 0, y: 0, z: 0 }
      cache.set(bodyId, origin)
      return origin
    }

    const localPosition = orbitToHeliocentricVector(body.orbit, julianDay)
    const absolutePosition = body.parentId ? addVector3(resolve(body.parentId), localPosition) : localPosition

    cache.set(bodyId, absolutePosition)
    return absolutePosition
  }

  return resolve
}

export function estimateAphelionDistance(body: CelestialBody, bodiesById: Map<BodyId, CelestialBody>): number {
  if (!body.orbit) {
    return 0
  }

  const localDistance =
    body.orbit.model === 'planetaryApprox'
      ? body.orbit.base.semiMajorAxisAU * (1 + body.orbit.base.eccentricity)
      : body.orbit.semiMajorAxisAU * (1 + body.orbit.eccentricity)

  if (!body.parentId) {
    return localDistance
  }

  const parent = bodiesById.get(body.parentId)
  if (!parent) {
    return localDistance
  }

  return localDistance + estimateAphelionDistance(parent, bodiesById)
}
