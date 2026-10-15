import { solveEllipticKeplerRadians } from './kepler'

const RAD = Math.PI / 180
export const CATALOG_ELEMENT_STRIDE = 8
export type CatalogPointMode = '2d' | '3d'

export const PREPARED_CATALOG_STRIDE = 10
export type PreparedCatalogElements = { readonly data: Float64Array; readonly count: number }
/** Scratch for one synchronous propagation lane. Reuse sequentially; never
 * share it across concurrent or reentrant propagation calls. */
export type CatalogPointWorkspace = Readonly<{ keplerTrigonometry: Float64Array }>

export function createCatalogPointWorkspace(): CatalogPointWorkspace {
  return Object.freeze({ keplerTrigonometry: new Float64Array(2) })
}

/** Validates immutable source elements once and prepares six rotation/scale
 * coefficients in Float64. Phase arithmetic retains the source degrees. */
export function prepareCatalogElementRange(elements: Float64Array, prepared: PreparedCatalogElements, start = 0, end = prepared.count) {
  if (elements.length % CATALOG_ELEMENT_STRIDE !== 0 || prepared.count !== elements.length / CATALOG_ELEMENT_STRIDE || prepared.data.length !== prepared.count * PREPARED_CATALOG_STRIDE) throw new Error('Catalog element buffer has an invalid stride')
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > prepared.count) throw new Error('Invalid catalog preparation range')
  for (let index = start; index < end; index++) prepareCatalogRecord(elements, index, prepared.data, index)
}

/** Prepare compact uploaded rows directly from their source-shard indices. */
export function prepareCatalogSourceRowsRange(elements: Float64Array, sourceRows: Uint32Array,
  prepared: PreparedCatalogElements, start = 0, end = prepared.count) {
  if (elements.length % CATALOG_ELEMENT_STRIDE !== 0 || !(sourceRows instanceof Uint32Array) ||
      prepared.count !== sourceRows.length || prepared.data.length !== prepared.count * PREPARED_CATALOG_STRIDE) {
    throw new Error('Catalog source-row preparation has an invalid stride')
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > prepared.count) throw new Error('Invalid catalog source-row preparation range')
  let previous = start ? sourceRows[start - 1] : -1
  const sourceCount = elements.length / CATALOG_ELEMENT_STRIDE
  for (let index = start; index < end; index++) {
    const sourceRow = sourceRows[index]
    if (sourceRow <= previous || sourceRow >= sourceCount) throw new Error('Catalog source-row preparation is not strictly ordered')
    prepareCatalogRecord(elements, sourceRow, prepared.data, index)
    previous = sourceRow
  }
}

function prepareCatalogRecord(elements: Float64Array, sourceRow: number, data: Float64Array, outputRow: number) {
  const offset = sourceRow * CATALOG_ELEMENT_STRIDE, out = outputRow * PREPARED_CATALOG_STRIDE
  for (let field = 0; field < CATALOG_ELEMENT_STRIDE; field++) if (!Number.isFinite(elements[offset + field])) throw new Error(`Catalog record ${sourceRow} has a nonfinite orbital element`)
  const a = elements[offset + 1], e = elements[offset + 2], motion = elements[offset + 7]
  if (!(a > 0) || e < 0 || e >= 1 || !(motion > 0)) throw new Error(`Catalog record ${sourceRow} is not a supported elliptic orbit`)
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

export function prepareCatalogElements(elements: Float64Array): PreparedCatalogElements {
  if (elements.length % CATALOG_ELEMENT_STRIDE !== 0) throw new Error('Catalog element buffer has an invalid stride')
  const count = elements.length / CATALOG_ELEMENT_STRIDE
  const prepared = { data: new Float64Array(count * PREPARED_CATALOG_STRIDE), count }
  prepareCatalogElementRange(elements, prepared)
  return prepared
}

/** Reuses caller-owned output and supports bounded ranges for cooperative
 * worker jobs. Science stays Float64 until the final display conversion. */
export function propagatePreparedCatalogPositions(prepared: PreparedCatalogElements, julianDay: number, mode: CatalogPointMode, output: Float64Array, start?: number, end?: number, workspace?: CatalogPointWorkspace): Float64Array
export function propagatePreparedCatalogPositions(prepared: PreparedCatalogElements, julianDay: number, mode: CatalogPointMode, output?: Float32Array, start?: number, end?: number, workspace?: CatalogPointWorkspace): Float32Array
export function propagatePreparedCatalogPositions(prepared: PreparedCatalogElements, julianDay: number, mode: CatalogPointMode,
  output?: Float32Array | Float64Array, start = 0, end = prepared.count, workspace?: CatalogPointWorkspace) {
  if (mode !== '2d' && mode !== '3d') throw new Error('Invalid catalog point mode')
  if (!Number.isFinite(julianDay) || !Number.isSafeInteger(prepared.count) || prepared.count < 0 || prepared.data.length !== prepared.count * PREPARED_CATALOG_STRIDE) throw new Error('Invalid catalog epoch or prepared capacity')
  const stride = mode === '2d' ? 2 : 3, positions = output ?? new Float32Array(prepared.count * stride)
  if (positions.length !== prepared.count * stride) throw new Error('Catalog point output has the wrong capacity')
  return propagatePreparedRange(prepared, julianDay, mode, positions, start, end, start, workspace)
}

/** Recompute one source range into a reusable bounded Float64 tile. Output
 * starts at row zero even when the retained source range starts elsewhere. */
export function propagatePreparedCatalogTile(prepared: PreparedCatalogElements, julianDay: number, mode: CatalogPointMode,
  start: number, end: number, output: Float64Array, workspace?: CatalogPointWorkspace) {
  const stride = mode === '2d' ? 2 : 3
  if (output.length !== (end-start)*stride) throw new Error('Catalog temporal tile has the wrong capacity')
  return propagatePreparedRange(prepared, julianDay, mode, output, start, end, 0, workspace)
}

function propagatePreparedRange<T extends Float32Array | Float64Array>(prepared: PreparedCatalogElements, julianDay: number,
  mode: CatalogPointMode, positions: T, start: number, end: number, outputStart: number, workspace?: CatalogPointWorkspace): T {
  if (mode !== '2d' && mode !== '3d') throw new Error('Invalid catalog point mode')
  if (!Number.isFinite(julianDay)) throw new Error('Invalid catalog point epoch')
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > prepared.count || prepared.data.length !== prepared.count * PREPARED_CATALOG_STRIDE) throw new Error('Invalid catalog compute range')
  const stride = mode === '2d' ? 2 : 3, data = prepared.data
  const keplerTrigonometry = workspace === undefined ? new Float64Array(2) : workspace.keplerTrigonometry
  if (!(keplerTrigonometry instanceof Float64Array) || keplerTrigonometry.length !== 2 ||
      keplerTrigonometry.buffer === data.buffer || keplerTrigonometry.buffer === positions.buffer) {
    throw new Error('Catalog propagation workspace must own a separate two-value Float64 buffer')
  }
  for (let index = start; index < end; index++) {
    const offset = index * PREPARED_CATALOG_STRIDE, out = (outputStart+index-start) * stride
    const meanAnomaly = (data[offset + 2] + data[offset + 3] * (julianDay - data[offset])) * RAD
    try { solveEllipticKeplerRadians(meanAnomaly, data[offset + 1], keplerTrigonometry) }
    catch (error) { throw new RangeError(`Catalog record ${index} failed elliptic Kepler propagation`, { cause: error }) }
    const x = (1 - data[offset + 1]) - 2 * keplerTrigonometry[0] ** 2, y = keplerTrigonometry[1]
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
  const keplerTrigonometry = new Float64Array(2)
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
    try {
      solveEllipticKeplerRadians(meanAnomaly, eccentricity, keplerTrigonometry)
    } catch (error) {
      throw new RangeError(`Catalog record ${index} failed elliptic Kepler propagation`, { cause: error })
    }
    const orbitalX = semiMajorAxisAU * ((1 - eccentricity) - 2 * keplerTrigonometry[0] ** 2)
    const orbitalY = semiMajorAxisAU * Math.sqrt((1 - eccentricity) * (1 + eccentricity)) * keplerTrigonometry[1]
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
