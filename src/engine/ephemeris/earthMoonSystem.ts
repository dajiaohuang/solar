import modelEvidence from '../../data/modelEvidence.json'
import type { Vector3 } from '../../types'

const evidence = modelEvidence.earthMoonMassPartition

function parsePositiveParameter(value: string, label: string) {
  const parameter = Number(value)
  if (!Number.isFinite(parameter) || parameter <= 0) {
    throw new RangeError(`${label} must be a positive finite gravitational parameter`)
  }
  return parameter
}

export const EARTH_MOON_GRAVITATIONAL_PARAMETERS = Object.freeze({
  earthKm3PerS2: parsePositiveParameter(evidence.earthGm, 'Earth GM'),
  moonKm3PerS2: parsePositiveParameter(evidence.moonGm, 'Moon GM'),
  systemKm3PerS2: parsePositiveParameter(evidence.systemGm, 'Earth-Moon system GM'),
})

const componentSum =
  EARTH_MOON_GRAVITATIONAL_PARAMETERS.earthKm3PerS2 +
  EARTH_MOON_GRAVITATIONAL_PARAMETERS.moonKm3PerS2

if (Math.abs(componentSum - EARTH_MOON_GRAVITATIONAL_PARAMETERS.systemKm3PerS2) > 1e-9) {
  throw new RangeError('DE440 Earth and Moon gravitational parameters do not reproduce the system GM')
}

export const EARTH_MOON_MASS_FRACTIONS = Object.freeze({
  earth: EARTH_MOON_GRAVITATIONAL_PARAMETERS.earthKm3PerS2 / componentSum,
  moon: EARTH_MOON_GRAVITATIONAL_PARAMETERS.moonKm3PerS2 / componentSum,
})

export function partitionEarthMoonBarycenter(
  embHeliocentric: Vector3,
  earthToMoon: Vector3,
) {
  const moonFraction = EARTH_MOON_MASS_FRACTIONS.moon
  const earthFraction = EARTH_MOON_MASS_FRACTIONS.earth

  return {
    earthGeocenter: {
      x: embHeliocentric.x - moonFraction * earthToMoon.x,
      y: embHeliocentric.y - moonFraction * earthToMoon.y,
      z: embHeliocentric.z - moonFraction * earthToMoon.z,
    },
    moonCenter: {
      x: embHeliocentric.x + earthFraction * earthToMoon.x,
      y: embHeliocentric.y + earthFraction * earthToMoon.y,
      z: embHeliocentric.z + earthFraction * earthToMoon.z,
    },
  }
}
