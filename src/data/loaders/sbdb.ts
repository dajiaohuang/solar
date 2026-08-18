import type { CelestialBody } from '../../types'

type SbdbElement = {
  name?: string
  value?: string | number | null
  units?: string | null
  sigma?: string | number | null
}

export type SbdbResponse = {
  object?: {
    fullname?: string
    des?: string
    orbit_class?: { code?: string; name?: string }
  }
  orbit?: {
    epoch?: string | number
    elements?: SbdbElement[]
    condition_code?: string | number
  }
  phys_par?: Array<{ name?: string; value?: string | number | null }>
}

export class SbdbParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SbdbParseError'
  }
}

function finiteNumber(value: unknown, field: string) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new SbdbParseError(`JPL SBDB response is missing a finite ${field} element`)
  }
  return parsed
}

function normalizedUnits(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replaceAll(' ', '')
}

function requiredElement(
  elements: Map<string | undefined, SbdbElement>,
  name: string,
  acceptedUnits: string[],
) {
  const element = elements.get(name)
  if (!element) throw new SbdbParseError(`JPL SBDB response is missing the ${name} element`)
  const units = normalizedUnits(element.units)
  if (!acceptedUnits.includes(units)) {
    throw new SbdbParseError(
      `JPL SBDB ${name} element uses unsupported units "${element.units ?? 'unitless'}"; expected ${acceptedUnits.map((unit) => unit || 'unitless').join(' or ')}`,
    )
  }
  return finiteNumber(element.value, name)
}

export function parseSbdbBody(response: SbdbResponse, fallbackDesignation: string): CelestialBody {
  const orbit = response.orbit
  if (!orbit || !Array.isArray(orbit.elements)) {
    throw new SbdbParseError('JPL SBDB response does not contain orbit.elements')
  }

  const elements = new Map(orbit.elements.map((element) => [element.name, element]))
  const e = requiredElement(elements, 'e', [''])
  const a = requiredElement(elements, 'a', ['au'])
  if (e < 0 || e >= 1) {
    throw new SbdbParseError(
      `The selected object has eccentricity ${e}; Solar Atlas requires 0 <= e < 1 for elliptic SBDB orbits`,
    )
  }
  if (a <= 0) throw new SbdbParseError(`The selected object has semi-major axis ${a}; elliptic SBDB orbits require a > 0`)

  const epochJd = finiteNumber(orbit.epoch, 'epoch')
  if (epochJd < 2_000_000 || epochJd > 3_000_000) {
    throw new SbdbParseError(`JPL SBDB epoch ${epochJd} is outside the supported Julian Date range`)
  }
  const meanMotion = requiredElement(elements, 'n', ['deg/d', 'deg/day'])
  if (meanMotion <= 0) throw new SbdbParseError(`The selected object has mean motion ${meanMotion}; elliptic SBDB orbits require n > 0`)
  const inclinationDeg = requiredElement(elements, 'i', ['deg'])
  if (inclinationDeg < 0 || inclinationDeg > 180) {
    throw new SbdbParseError(`The selected object has inclination ${inclinationDeg}; expected 0 to 180 deg`)
  }
  const ascendingNodeDeg = requiredElement(elements, 'om', ['deg'])
  const argPeriapsisDeg = requiredElement(elements, 'w', ['deg'])
  const meanAnomalyDeg = requiredElement(elements, 'ma', ['deg'])
  const absoluteMagnitudeEntry = response.phys_par?.find((entry) => entry.name === 'H')
  const absoluteMagnitude = absoluteMagnitudeEntry
    ? Number(absoluteMagnitudeEntry.value)
    : undefined
  const designation = response.object?.des || fallbackDesignation
  const fullName = response.object?.fullname?.trim() || designation

  return {
    id: `sbdb:${designation.replace(/\s+/g, '_')}`,
    name: fullName,
    shortName: fullName.replace(/^\s*\(?\d+\)?\s*/, ''),
    kind: 'asteroid',
    color: '#f6b36b',
    size: 2.6,
    source: 'jpl-sbdb',
    orbitClassCode: response.object?.orbit_class?.code,
    orbitClassName: response.object?.orbit_class?.name,
    absoluteMagnitude: Number.isFinite(absoluteMagnitude) ? absoluteMagnitude : undefined,
    orbitUncertainty: orbit.condition_code === undefined ? undefined : String(orbit.condition_code),
    dataEpochLabel: `JD ${epochJd} TDB (JPL SBDB)`,
    isCatalogBody: true,
    orbit: {
      model: 'keplerian',
      epochJd,
      semiMajorAxisAU: a,
      eccentricity: e,
      inclinationDeg,
      ascendingNodeDeg,
      argPeriapsisDeg,
      meanAnomalyDeg,
      meanMotionDegPerDay: meanMotion,
    },
  }
}

export async function fetchSbdbBody(designation: string, signal?: AbortSignal) {
  const url = new URL('https://ssd-api.jpl.nasa.gov/sbdb.api')
  url.searchParams.set('sstr', designation)
  url.searchParams.set('full-prec', '1')
  url.searchParams.set('phys-par', '1')
  const response = await fetch(url, { signal })
  const payload = await response.json() as SbdbResponse & { message?: string }
  if (!response.ok || payload.message) {
    throw new Error(payload.message || `JPL SBDB request failed (${response.status})`)
  }
  return parseSbdbBody(payload, designation)
}
