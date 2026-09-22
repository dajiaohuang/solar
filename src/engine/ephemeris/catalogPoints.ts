import { solveEllipticKeplerRadians } from './kepler'

const RAD = Math.PI / 180
export const CATALOG_ELEMENT_STRIDE = 8
export type CatalogPointMode = '2d' | '3d'

export const PREPARED_CATALOG_STRIDE = 10
export type PreparedCatalogElements = { readonly data: Float64Array; readonly count: number }

/** Validates immutable source elements once and prepares six rotation/scale
 * coefficients in Float64. Phase arithmetic retains the source degrees. */
export function prepareCatalogElementRange(elements: Float64Array, prepared: PreparedCatalogElements, start = 0, end = prepared.count) {
  if (elements.length % CATALOG_ELEMENT_STRIDE !== 0 || prepared.count !== elements.length / CATALOG_ELEMENT_STRIDE || prepared.data.length !== prepared.count * PREPARED_CATALOG_STRIDE) throw new Error('Catalog element buffer has an invalid stride')
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > prepared.count) throw new Error('Invalid catalog preparation range')
  const data = prepared.data
  for (let index = start; index < end; index++) {
    const offset = index * CATALOG_ELEMENT_STRIDE, out = index * PREPARED_CATALOG_STRIDE
    for (let field = 0; field < CATALOG_ELEMENT_STRIDE; field++) if (!Number.isFinite(elements[offset + field])) throw new Error(`Catalog record ${index} has a nonfinite orbital element`)
    const a = elements[offset + 1], e = elements[offset + 2], motion = elements[offset + 7]
    if (!(a > 0) || e < 0 || e >= 1 || !(motion > 0)) throw new Error(`Catalog record ${index} is not a supported elliptic orbit`)
    const inclination = elements[offset + 3] * RAD, node = elements[offset + 4] * RAD, periapsis = elements[offset + 5] * RAD
    const cosW = Math.cos(periapsis), sinW = Math.sin(periapsis), cosO = Math.cos(node), sinO = Math.sin(node), cosI = Math.cos(inclination), sinI = Math.sin(inclination)
    const b = a * Math.sqrt((1 - e) * (1 + e))
    data[out] = elements[offset]; data[out + 1] = e; data[out + 2] = elements[offset + 6]; data[out + 3] = motion
    data[out + 4] = a * (cosW * cosO - sinW * sinO * cosI)
    data[out + 5] = a * (cosW * sinO + sinW * cosO * cosI)
    data[out + 6] = a * sinW * sinI
    data[out + 7] = b * (-sinW * cosO - cosW * sinO * cosI)
    data[out + 8] = b * (-sinW * sinO + cosW * cosO * cosI)
    data[out + 9] = b * cosW * sinI
  }
}

export function prepareCatalogElements(elements: Float64Array): PreparedCatalogElements {
  if (elements.length % CATALOG_ELEMENT_STRIDE !== 0) throw new Error('Catalog element buffer has an invalid stride')
  const count = elements.length / CATALOG_ELEMENT_STRIDE
  const prepared = { data: new Float64Array(count * PREPARED_CATALOG_STRIDE), count }
  prepareCatalogElementRange(elements, prepared)
  return prepared
}

/** Reuses caller-owned output and supports bounded ranges for cooperative
 * worker jobs. Science stays Float64 until the final display conversion. */
export function propagatePreparedCatalogPositions(prepared: PreparedCatalogElements, julianDay: number, mode: CatalogPointMode, output?: Float32Array, start = 0, end = prepared.count) {
  if (mode !== '2d' && mode !== '3d') throw new Error('Invalid catalog point mode')
  if (!Number.isFinite(julianDay)) throw new Error('Invalid catalog point epoch')
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > prepared.count || prepared.data.length !== prepared.count * PREPARED_CATALOG_STRIDE) throw new Error('Invalid catalog compute range')
  const stride = mode === '2d' ? 2 : 3, positions = output ?? new Float32Array(prepared.count * stride), data = prepared.data
  if (positions.length !== prepared.count * stride) throw new Error('Catalog point output has the wrong capacity')
  for (let index = start; index < end; index++) {
    const offset = index * PREPARED_CATALOG_STRIDE, out = index * stride
    const meanAnomaly = (data[offset + 2] + data[offset + 3] * (julianDay - data[offset])) * RAD
    let eccentricAnomaly: number
    try { eccentricAnomaly = solveEllipticKeplerRadians(meanAnomaly, data[offset + 1]) }
    catch (error) { throw new RangeError(`Catalog record ${index} failed elliptic Kepler propagation`, { cause: error }) }
    const x = (1 - data[offset + 1]) - 2 * Math.sin(eccentricAnomaly / 2) ** 2, y = Math.sin(eccentricAnomaly)
    positions[out] = data[offset + 4] * x + data[offset + 7] * y
    positions[out + 1] = data[offset + 5] * x + data[offset + 8] * y
    if (mode === '3d') positions[out + 2] = data[offset + 6] * x + data[offset + 9] * y
    if (!Number.isFinite(positions[out]) || !Number.isFinite(positions[out + 1]) || (mode === '3d' && !Number.isFinite(positions[out + 2]))) throw new RangeError(`Catalog record ${index} exceeds finite display coordinates`)
  }
  return positions
}

/** Evaluate at a TT Julian date, matching MPCORB's source element epochs. */
export function propagateCatalogElementPositions(
  elements: Float64Array,
  julianDay: number,
  mode: CatalogPointMode,
  onProgress?: (progress: number) => void,
) {
  if (elements.length % CATALOG_ELEMENT_STRIDE !== 0) throw new Error('Catalog element buffer has an invalid stride')
  if (mode !== '2d' && mode !== '3d') throw new Error('Invalid catalog point mode')
  if (!Number.isFinite(julianDay)) throw new Error('Invalid catalog point epoch')
  const count = elements.length / CATALOG_ELEMENT_STRIDE
  const stride = mode === '2d' ? 2 : 3
  const positions = new Float32Array(count * stride)
  for (let index = 0; index < count; index += 1) {
    const offset = index * CATALOG_ELEMENT_STRIDE
    for (let field = 0; field < CATALOG_ELEMENT_STRIDE; field++) {
      if (!Number.isFinite(elements[offset + field])) throw new Error(`Catalog record ${index} has a nonfinite orbital element`)
    }
    const epochJd = elements[offset]
    const semiMajorAxisAU = elements[offset + 1]
    const eccentricity = elements[offset + 2]
    if (!(semiMajorAxisAU > 0) || !Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1) {
      throw new Error(`Catalog record ${index} is not a supported elliptic orbit`)
    }
    const inclination = elements[offset + 3] * RAD
    const ascendingNode = elements[offset + 4] * RAD
    const argPeriapsis = elements[offset + 5] * RAD
    const meanAnomaly = (elements[offset + 6] + elements[offset + 7] * (julianDay - epochJd)) * RAD
    let eccentricAnomaly: number
    try {
      eccentricAnomaly = solveEllipticKeplerRadians(meanAnomaly, eccentricity)
    } catch (error) {
      throw new RangeError(`Catalog record ${index} failed elliptic Kepler propagation`, { cause: error })
    }
    const orbitalX = semiMajorAxisAU * ((1 - eccentricity) - 2 * Math.sin(eccentricAnomaly / 2) ** 2)
    const orbitalY = semiMajorAxisAU * Math.sqrt((1 - eccentricity) * (1 + eccentricity)) * Math.sin(eccentricAnomaly)
    const cosW = Math.cos(argPeriapsis), sinW = Math.sin(argPeriapsis)
    const cosO = Math.cos(ascendingNode), sinO = Math.sin(ascendingNode), cosI = Math.cos(inclination), sinI = Math.sin(inclination)
    const x = (cosW * cosO - sinW * sinO * cosI) * orbitalX +
      (-sinW * cosO - cosW * sinO * cosI) * orbitalY
    const y = (cosW * sinO + sinW * cosO * cosI) * orbitalX +
      (-sinW * sinO + cosW * cosO * cosI) * orbitalY
    const z = sinW * sinI * orbitalX + cosW * sinI * orbitalY
    positions[index * stride] = x
    positions[index * stride + 1] = y
    if (mode === '3d') positions[index * stride + 2] = z
    if (index > 0 && index % 50_000 === 0) onProgress?.(index / count)
  }
  return positions
}
