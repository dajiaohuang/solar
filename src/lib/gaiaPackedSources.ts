import columnsV1 from '../data/gaiaColumns.json'
import columnsV2 from '../data/gaiaColumnsV2.json'
import capacity from '../data/gaiaCapacity.json'
import type { GaiaChunk, GaiaSource } from './gaiaChunks'
import { createGaiaDisplayPointWriter } from './gaiaProjection'

export type GaiaPackedSourceBatch = {
  rowCount: number
  sourceIds: BigInt64Array<ArrayBuffer>
  values: Float64Array<ArrayBuffer>
  nullFlags: Uint8Array<ArrayBuffer>
}

type Segment = { start: number; batch: GaiaPackedSourceBatch }
const columnKeysV1 = new Set<string>(columnsV1)
const columnKeysV2 = new Set<string>(columnsV2)

function canonicalColumns(schemaVersion: 1 | 2) {
  if (schemaVersion === 1) return columnsV1
  if (schemaVersion === 2) return columnsV2
  throw new Error('Unsupported Gaia packed-source column schema')
}

function hasExactEnumerableColumns(row: object, keys: ReadonlySet<string>) {
  let count = 0
  for (const key in row) {
    if (!Object.hasOwn(row, key)) continue
    if (!keys.has(key)) return false
    count++
  }
  return count === keys.size
}

export function gaiaNumericFieldCount(schemaVersion: 1 | 2) {
  return canonicalColumns(schemaVersion).length - 1
}

function nullFlagLength(rows: number, fields: number) {
  return Math.ceil(rows * fields / 8)
}

export function isGaiaPackedSourceBatch(value: unknown, expectedRows: number, numericFields: number): value is GaiaPackedSourceBatch {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(expectedRows) || expectedRows < 0 || expectedRows > capacity.maxChunkRows ||
      numericFields !== columnsV1.length-1 && numericFields !== columnsV2.length-1) return false
  const batch = value as Partial<GaiaPackedSourceBatch>
  return batch.rowCount === expectedRows && Number.isSafeInteger(batch.rowCount) && batch.rowCount >= 0
    && batch.sourceIds instanceof BigInt64Array && batch.sourceIds.length === expectedRows
    && batch.values instanceof Float64Array && batch.values.length === expectedRows * numericFields
    && batch.nullFlags instanceof Uint8Array && batch.nullFlags.length === nullFlagLength(expectedRows, numericFields)
}

type GaiaDisplaySettings = { centerRaDeg: number; centerDecDeg: number; radiusDeg: number; maximumRadiusDeg?: number }
type GaiaPackedPresentation = { sources: GaiaPackedSourceBatch; display: Float32Array<ArrayBuffer> | undefined }

/** Pack source fields and, when requested, project display points in the same row pass. */
async function packGaiaPresentation(
  chunk: Pick<GaiaChunk, 'sources' | 'sourceIds'> & Partial<Pick<GaiaChunk, 'directionsICRS' | 'sourceIdStringsOmitted'>>,
  schemaVersion: 1 | 2,
  signal: AbortSignal,
  displaySettings?: GaiaDisplaySettings,
  sourceRows?: Uint32Array,
): Promise<GaiaPackedPresentation> {
  const schema = canonicalColumns(schemaVersion)
  const schemaKeys = schemaVersion === 1 ? columnKeysV1 : columnKeysV2
  const rows = chunk.sources, sourceIds = chunk.sourceIds
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > capacity.maxChunkRows) throw new Error('Gaia packed-source row budget exceeded')
  const outputRows = sourceRows?.length ?? rows.length
  if (sourceRows && (outputRows > rows.length || sourceRows.some(row => row >= rows.length))) throw new Error('Invalid Gaia packed-source row selection')
  const fields = schema.slice(1), values = new Float64Array(outputRows * fields.length)
  if (!(sourceIds instanceof BigInt64Array) || sourceIds.length !== rows.length) throw new Error('Gaia packed-source ID column mismatch')
  const outputSourceIds = sourceRows ? new BigInt64Array(outputRows) : sourceIds
  const sourceIdStringsOmitted = chunk.sourceIdStringsOmitted === true
  const directions = chunk.directionsICRS
  const hasDirections = directions instanceof Float64Array && directions.length === rows.length*3
  if (displaySettings && (!(directions instanceof Float64Array) || (!hasDirections && directions.length !== 0))) throw new Error('Gaia packed display direction shape mismatch')
  const display = displaySettings ? new Float32Array(outputRows*3) : undefined
  const writeDisplayPoint = displaySettings ? createGaiaDisplayPointWriter(displaySettings.centerRaDeg, displaySettings.centerDecDeg, displaySettings.radiusDeg, displaySettings.maximumRadiusDeg) : undefined
  const directionScratch = displaySettings && !hasDirections ? new Float64Array(3) : undefined
  const nullFlags = new Uint8Array(nullFlagLength(outputRows, fields.length))
  for (let outputIndex = 0; outputIndex < outputRows; outputIndex++) {
    if (outputIndex && outputIndex % 1024 === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      signal.throwIfAborted()
    }
    const rowIndex = sourceRows?.[outputIndex] ?? outputIndex
    const row = rows[rowIndex]
    if (!row || typeof row !== 'object' || !hasExactEnumerableColumns(row, schemaKeys)) {
      throw new Error('Gaia packed-source columns mismatch')
    }
    const id = row.source_id
    if (sourceIdStringsOmitted ? id !== '' : typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id)) throw new Error('Invalid Gaia packed source ID')
    // decodeVerifiedChunk already parsed and range-checked this ID; keep and
    // transfer the same typed column instead of parsing and allocating again.
    if (sourceIds[rowIndex] <= 0n) throw new Error('Invalid Gaia packed source ID')
    outputSourceIds[outputIndex] = sourceIds[rowIndex]
    const base = outputIndex * fields.length
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
      const value = row[fields[fieldIndex]]
      const valueIndex = base + fieldIndex
      if (value === null) nullFlags[valueIndex >>> 3] |= 1 << (valueIndex & 7)
      else if (typeof value === 'number' && Number.isFinite(value)) values[valueIndex] = value
      else throw new Error(`Invalid Gaia packed numeric field: ${fields[fieldIndex]}`)
    }
    if (display && writeDisplayPoint) {
      if (directionScratch) {
        const raDegrees = row.ra, decDegrees = row.dec
        if (typeof raDegrees !== 'number' || raDegrees < 0 || raDegrees >= 360 || typeof decDegrees !== 'number' || Math.abs(decDegrees) > 90) {
          throw new Error('Invalid Gaia display source coordinates')
        }
        const ra = raDegrees*Math.PI/180, dec = decDegrees*Math.PI/180, cos = Math.cos(dec)
        directionScratch[0] = cos*Math.cos(ra); directionScratch[1] = cos*Math.sin(ra); directionScratch[2] = Math.sin(dec)
        writeDisplayPoint(directionScratch, 0, row.phot_g_mean_mag, display, outputIndex*3)
      } else {
        writeDisplayPoint(directions!, rowIndex*3, row.phot_g_mean_mag, display, outputIndex*3)
      }
    }
  }
  signal.throwIfAborted()
  return { sources: { rowCount: outputRows, sourceIds: outputSourceIds, values, nullFlags }, display }
}

/** Convert validated Gaia rows into transferable exact-number columns. */
export async function packGaiaSources(
  chunk: Pick<GaiaChunk, 'sources' | 'sourceIds'> & Partial<Pick<GaiaChunk, 'sourceIdStringsOmitted'>>,
  schemaVersion: 1 | 2,
  signal: AbortSignal,
): Promise<GaiaPackedSourceBatch> {
  return (await packGaiaPresentation(chunk, schemaVersion, signal)).sources
}

/** Build display coordinates and transferable source columns with one row traversal. */
export async function packGaiaSourcesAndDisplay(
  chunk: GaiaChunk,
  schemaVersion: 1 | 2,
  displaySettings: GaiaDisplaySettings,
  signal: AbortSignal,
  seenSourceIds?: Set<bigint>,
): Promise<{ sources: GaiaPackedSourceBatch; display: Float32Array<ArrayBuffer>; duplicateRows: number }> {
  let sourceRows: Uint32Array | undefined, uniqueRows = 0, duplicateRows = 0
  if (seenSourceIds) {
    for (let row = 0; row < chunk.sourceIds.length; row++) {
      const id = chunk.sourceIds[row];
      const priorSeenSourceIdCount = seenSourceIds.size;
      seenSourceIds.add(id);
      if (seenSourceIds.size === priorSeenSourceIdCount) {
        if (!sourceRows) {
          sourceRows = new Uint32Array(chunk.sourceIds.length);
          for (let prior = 0; prior < row; prior++) sourceRows[prior] = prior;
          uniqueRows = row;
        }
        duplicateRows++;
      } else {
        if (sourceRows) sourceRows[uniqueRows++] = row;
      }
    }
    if (sourceRows) sourceRows = sourceRows.subarray(0, uniqueRows)
  }
  const result = await packGaiaPresentation(chunk, schemaVersion, signal, displaySettings, sourceRows)
  if (!result.display) throw new Error('Gaia display projection was not prepared')
  return { sources: result.sources, display: result.display, duplicateRows }
}

/** Retain transferred Float64 columns and reconstruct only rows requested by UI/export. */
export class GaiaSourceStore {
  private readonly columns: readonly string[]
  private readonly fields: readonly string[]
  private readonly segments: Segment[] = []
  readonly capacity: number
  length = 0

  constructor(schemaVersion: 1 | 2, rowCapacity: number) {
    if (!Number.isSafeInteger(rowCapacity) || rowCapacity < 0 || rowCapacity > capacity.maxChartRows) throw new Error('Invalid Gaia packed-source capacity')
    this.columns = canonicalColumns(schemaVersion)
    this.fields = this.columns.slice(1)
    this.capacity = rowCapacity
  }

  append(batch: GaiaPackedSourceBatch) {
    if (!batch || typeof batch !== 'object' || !Number.isSafeInteger(batch.rowCount) ||
        batch.rowCount < 1 || !isGaiaPackedSourceBatch(batch, batch.rowCount, this.fields.length) || this.length + batch.rowCount > this.capacity) {
      throw new Error('Gaia packed-source batch exceeds manifest capacity')
    }
    this.segments.push({ start: this.length, batch })
    this.length += batch.rowCount
  }

  get(index: number): GaiaSource {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) throw new RangeError('Gaia source index is outside the loaded catalog')
    let low = 0, high = this.segments.length
    while (low < high) {
      const middle = low + ((high - low) >>> 1), segment = this.segments[middle]
      if (index < segment.start) high = middle
      else if (index >= segment.start + segment.batch.rowCount) low = middle + 1
      else return this.materialize(segment.batch, index - segment.start)
    }
    throw new Error('Gaia packed-source segment index is inconsistent')
  }

  *records(): IterableIterator<GaiaSource> {
    for (const segment of this.segments) {
      for (let row = 0; row < segment.batch.rowCount; row++) yield this.materialize(segment.batch, row)
    }
  }

  private materialize(batch: GaiaPackedSourceBatch, rowIndex: number): GaiaSource {
    const row = Object.create(null) as GaiaSource
    row.source_id = batch.sourceIds[rowIndex].toString()
    const base = rowIndex * this.fields.length
    for (let fieldIndex = 0; fieldIndex < this.fields.length; fieldIndex++) {
      const valueIndex = base + fieldIndex
      row[this.fields[fieldIndex]] = batch.nullFlags[valueIndex >>> 3] & (1 << (valueIndex & 7)) ? null : batch.values[valueIndex]
    }
    return row
  }
}
