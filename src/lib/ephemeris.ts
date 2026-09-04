import { J2000_JULIAN_DAY } from './julianDate'
import { partitionEarthMoonBarycenter } from '../engine/ephemeris/earthMoonSystem'
import { solveEllipticKeplerRadians } from '../engine/ephemeris/kepler'
import { loadedKernels, kernelsForWindow } from '../engine/ephemeris/kernelStore'
import { createKernelResolver, type LoadedKernel } from '../engine/ephemeris/kernelPool'
import { utcJulianDayToEt, utcJulianDayToTdb } from '../engine/ephemeris/timeScales'
import { bodyNaifId } from '../data/ephemerisTargets'
import { AU_IN_KM, SECONDS_PER_DAY } from '../engine/units'
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

export class UnsupportedOrbitError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedOrbitError'
  }
}

export class MissingBodyStateError extends Error {
  readonly bodyId: BodyId
  readonly julianDay: number
  constructor(bodyId: BodyId, julianDay: number) {
    super(`No position model is available for ${bodyId} at Julian day ${julianDay}`)
    this.name = 'MissingBodyStateError'
    this.bodyId = bodyId
    this.julianDay = julianDay
  }
}

/** Absence is not the origin. Do not swallow malformed models or other bugs. */
export function bodyPositionOrNull(resolve: (bodyId: BodyId) => Vector3, bodyId: BodyId): Vector3 | null {
  try { return resolve(bodyId) } catch (error) {
    if (error instanceof MissingBodyStateError) return null
    throw error
  }
}

export function normalizeDegrees(angle: number) {
  const wrapped = angle % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

function toRadians(angleDeg: number) {
  return angleDeg * DEG_TO_RAD
}

export function solveKeplerEquation(meanAnomalyDeg: number, eccentricity: number) {
  if (!Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1) {
    throw new UnsupportedOrbitError(
      `Elliptic Kepler propagation requires 0 <= eccentricity < 1; received ${eccentricity}`,
    )
  }

  return solveEllipticKeplerRadians(toRadians(meanAnomalyDeg), eccentricity) * RAD_TO_DEG
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
  // Before the supported civil-time era this is deliberately only a fallback;
  // no historical leap-second conversion is fabricated.
  const epoch = orbit.epochTimeScale === 'TDB' && julianDay >= 2441317.5 ? utcJulianDayToTdb(julianDay) : julianDay
  const elapsedDays = epoch - orbit.epochJd
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

export function getInstantaneousElements(orbit: OrbitDefinition, julianDay: number) {
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

  if (!Number.isFinite(semiMajorAxisAU) || semiMajorAxisAU <= 0) {
    throw new UnsupportedOrbitError(
      `Elliptic Kepler propagation requires a positive semi-major axis; received ${semiMajorAxisAU}`,
    )
  }

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

export function scaleVector3(vector: Vector3, scalar: number): Vector3 {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar }
}

export function dotVector3(a: Vector3, b: Vector3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function crossVector3(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function createBodyPositionResolver(bodiesById: Map<BodyId, CelestialBody>, julianDay: number, kernels: readonly LoadedKernel[] = loadedKernels()) {
  const cache = new Map<BodyId, Vector3>()
  const precise = kernels.length && julianDay >= 2441317.5
    ? createKernelResolver(kernels, utcJulianDayToEt(julianDay)) : null

  const resolveEarthMoonSystem = () => {
    const cachedEarth = cache.get('earth')
    const cachedMoon = cache.get('moon')
    if (cachedEarth && cachedMoon) return

    const earth = bodiesById.get('earth')
    const moon = bodiesById.get('moon')
    if (!earth?.orbit || earth.orbitRepresents !== 'earth-moon-barycenter') {
      throw new Error('Earth-Moon barycentric resolution requires an Earth EMB orbit seed')
    }
    if (!moon?.orbit || moon.parentId !== 'earth') {
      throw new Error('Earth-Moon barycentric resolution requires an Earth-centered Moon orbit')
    }

    const embHeliocentric = orbitToHeliocentricVector(earth.orbit, julianDay)
    const earthToMoon = orbitToHeliocentricVector(moon.orbit, julianDay)
    const partition = partitionEarthMoonBarycenter(embHeliocentric, earthToMoon)
    cache.set('earth', partition.earthGeocenter)
    cache.set('moon', partition.moonCenter)
  }

  const resolve = (bodyId: BodyId): Vector3 => {
    const cached = cache.get(bodyId)
    if (cached) {
      return cached
    }

    const body = bodiesById.get(bodyId)
    if (!body) {
      throw new Error(`Unknown body: ${bodyId}`)
    }

    const target = bodyNaifId(body)
    const state = precise && target !== undefined ? precise.relative(target, 10) : null
    if (state) {
      const position = scaleVector3(state.position, 1 / AU_IN_KM)
      cache.set(bodyId, position)
      return position
    }

    const earth = bodiesById.get('earth')
    if (
      (bodyId === 'earth' || bodyId === 'moon') &&
      earth?.orbitRepresents === 'earth-moon-barycenter'
    ) {
      resolveEarthMoonSystem()
      return cache.get(bodyId)!
    }

    if (!body.orbit) {
      if (bodyId !== 'sun') throw new MissingBodyStateError(bodyId, julianDay)
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

export function createBodyVelocityResolver(
  bodiesById: Map<BodyId, CelestialBody>,
  julianDay: number,
  stepDays = 0.01,
  kernels: readonly LoadedKernel[] = loadedKernels(),
) {
  const precise = kernels.length && julianDay >= 2441317.5
    ? createKernelResolver(kernels, utcJulianDayToEt(julianDay)) : null
  if (!Number.isFinite(stepDays) || stepDays <= 0) throw new RangeError('Velocity step must be positive and finite')
  const derivativeKernels = kernelsForWindow(julianDay - stepDays, julianDay + stepDays, kernels.map((kernel) => kernel.id))
  const before = createBodyPositionResolver(bodiesById, julianDay - stepDays, derivativeKernels)
  const after = createBodyPositionResolver(bodiesById, julianDay + stepDays, derivativeKernels)

  return (bodyId: BodyId): Vector3 => {
    const body = bodiesById.get(bodyId)
    const target = body ? bodyNaifId(body) : undefined
    const state = precise && target !== undefined ? precise.relative(target, 10) : null
    if (state) return scaleVector3(state.velocity, SECONDS_PER_DAY / AU_IN_KM)
    const delta = subtractVector3(after(bodyId), before(bodyId))
    return scaleVector3(delta, 1 / (2 * stepDays))
  }
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
