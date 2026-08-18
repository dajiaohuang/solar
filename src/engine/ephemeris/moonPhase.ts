import {
  crossVector3,
  dotVector3,
  subtractVector3,
  vector3Magnitude,
} from '../../lib/ephemeris'
import type { Vector3 } from '../../types'

export type MoonPhaseName =
  | 'new'
  | 'waxing-crescent'
  | 'first-quarter'
  | 'waxing-gibbous'
  | 'full'
  | 'waning-gibbous'
  | 'last-quarter'
  | 'waning-crescent'

export type MoonPhase = {
  phaseAngleDeg: number
  elongationDeg: number
  illuminatedFraction: number
  name: MoonPhaseName
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeRadians(value: number) {
  const wrapped = value % (Math.PI * 2)
  return wrapped < 0 ? wrapped + Math.PI * 2 : wrapped
}

/** Computes physical illumination at the Moon and signed geocentric elongation. */
export function computeMoonPhase(
  sunHeliocentric: Vector3,
  earthHeliocentric: Vector3,
  moonHeliocentric: Vector3,
): MoonPhase {
  const moonToSun = subtractVector3(sunHeliocentric, moonHeliocentric)
  const moonToEarth = subtractVector3(earthHeliocentric, moonHeliocentric)
  const earthToSun = subtractVector3(sunHeliocentric, earthHeliocentric)
  const earthToMoon = subtractVector3(moonHeliocentric, earthHeliocentric)

  const phaseCos = clamp(
    dotVector3(moonToSun, moonToEarth) /
      Math.max(vector3Magnitude(moonToSun) * vector3Magnitude(moonToEarth), Number.EPSILON),
    -1,
    1,
  )
  const phaseAngle = Math.acos(phaseCos)
  const illuminatedFraction = (1 + phaseCos) / 2

  const sunLength = Math.max(vector3Magnitude(earthToSun), Number.EPSILON)
  // All propagated coordinates use the JPL ecliptic frame, so +Z supplies a
  // stable orientation for waxing/waning signed elongation.
  const signedCross = crossVector3(earthToSun, earthToMoon).z
  const elongation = normalizeRadians(Math.atan2(
    signedCross / Math.max(sunLength * vector3Magnitude(earthToMoon), Number.EPSILON),
    dotVector3(earthToSun, earthToMoon) /
      Math.max(sunLength * vector3Magnitude(earthToMoon), Number.EPSILON),
  ))

  const sector = Math.round(elongation / (Math.PI / 4)) % 8
  const names: MoonPhaseName[] = [
    'new',
    'waxing-crescent',
    'first-quarter',
    'waxing-gibbous',
    'full',
    'waning-gibbous',
    'last-quarter',
    'waning-crescent',
  ]

  return {
    phaseAngleDeg: phaseAngle * 180 / Math.PI,
    elongationDeg: elongation * 180 / Math.PI,
    illuminatedFraction,
    name: names[sector],
  }
}
