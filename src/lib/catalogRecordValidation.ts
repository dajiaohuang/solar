import type { AsteroidIndexEntry, AsteroidRecord } from '../types'

/** Resolve an index against its declared shard and actual row, never a record
 * with the same ID found incidentally in another requested shard. */
export function bindCatalogIndexRecord<T extends AsteroidIndexEntry>(entry: AsteroidIndexEntry, record: T | undefined, rowIndex: number): T {
  if (!record) throw new Error(`Catalog index record is missing from its source shard: ${entry.id}`)
  const fields = ['id', 'packedDesignation', 'permanentNumber', 'label', 'shortLabel', 'searchKey',
    'chunkId', 'orbitClassCode', 'orbitClassName', 'absoluteMagnitude', 'isNeo', 'isPha'] as const
  if (fields.some(field => entry[field] !== record[field]) ||
      entry.rowIndex !== undefined && entry.rowIndex !== rowIndex ||
      record.rowIndex !== undefined && record.rowIndex !== rowIndex ||
      entry.chunkIndex !== undefined && entry.chunkIndex !== Number(record.chunkId.slice(6))) {
    throw new Error(`Catalog index differs from its source record: ${entry.id}`)
  }
  return record
}

export function validateCatalogMetadata(entries: AsteroidIndexEntry[], expectedChunk?: string): void {
  if (!Array.isArray(entries)) throw new Error('Catalog metadata must be an array')
  const ids = new Set<string>()
  const expectedMatch = expectedChunk === undefined ? null : /^chunk-(\d{4,})$/.exec(expectedChunk)
  const parsedExpectedChunk = expectedMatch ? Number(expectedMatch[1]) : NaN
  const expectedChunkIndex = Number.isSafeInteger(parsedExpectedChunk) && parsedExpectedChunk >= 0 &&
    expectedChunk === `chunk-${String(parsedExpectedChunk).padStart(4, '0')}` ? parsedExpectedChunk : undefined
  for (let row = 0; row < entries.length; row++) {
    validateCatalogMetadataRow(entries[row], row, ids, expectedChunk, expectedChunkIndex)
  }
}

/** Callers processing a shard incrementally must share the same identity set. */
export function validateCatalogMetadataRow(entry: AsteroidIndexEntry, row: number, ids: Set<string>, expectedChunk?: string, expectedChunkIndex?: number): void {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      typeof entry.id !== 'string' || !entry.id.length ||
      typeof entry.label !== 'string' || !entry.label.length ||
      typeof entry.shortLabel !== 'string' || !entry.shortLabel.length ||
      typeof entry.searchKey !== 'string' || !entry.searchKey.length ||
      typeof entry.orbitClassCode !== 'string' || !entry.orbitClassCode.length ||
      typeof entry.orbitClassName !== 'string' || !entry.orbitClassName.length ||
      entry.packedDesignation !== undefined && (typeof entry.packedDesignation !== 'string' || !entry.packedDesignation.length) ||
      typeof entry.isNeo !== 'boolean' || typeof entry.isPha !== 'boolean' ||
      entry.absoluteMagnitude !== undefined && !Number.isFinite(entry.absoluteMagnitude) ||
      entry.permanentNumber !== undefined && (!Number.isSafeInteger(entry.permanentNumber) || entry.permanentNumber < 1)) {
    throw new Error(`Invalid catalog metadata in row ${row}`)
  }
  if (expectedChunk !== undefined && expectedChunkIndex !== undefined) {
    if (entry.chunkId !== expectedChunk || entry.chunkIndex !== undefined && entry.chunkIndex !== expectedChunkIndex ||
        entry.rowIndex !== undefined && (!Number.isSafeInteger(entry.rowIndex) || entry.rowIndex !== row)) {
      throw new Error(`Catalog metadata locator does not match its source row ${row}`)
    }
  } else {
    const match = typeof entry.chunkId === 'string' && /^chunk-(\d{4,})$/.exec(entry.chunkId)
    const chunk = match ? Number(match[1]) : NaN
    if (!Number.isSafeInteger(chunk) || chunk < 0 || entry.chunkId !== `chunk-${String(chunk).padStart(4, '0')}` ||
        entry.chunkIndex !== undefined && entry.chunkIndex !== chunk ||
        entry.rowIndex !== undefined && (!Number.isSafeInteger(entry.rowIndex) || entry.rowIndex < 0) ||
        expectedChunk !== undefined && (entry.chunkId !== expectedChunk || entry.rowIndex !== undefined && entry.rowIndex !== row)) {
      throw new Error(`Catalog metadata locator does not match its source row ${row}`)
    }
  }
  if (ids.has(entry.id)) throw new Error(`Duplicate catalog identity in shard: ${entry.id}`)
  ids.add(entry.id)
}

export function validateCatalogRecords(records: AsteroidRecord[], expectedChunk: string): AsteroidRecord[] {
  validateCatalogMetadata(records, expectedChunk)
  for (let row = 0; row < records.length; row++) {
    const r = records[row]
    if (![r.epochJd, r.semiMajorAxisAU, r.eccentricity, r.inclinationDeg, r.ascendingNodeDeg,
      r.argPeriapsisDeg, r.meanAnomalyDeg, r.meanMotionDegPerDay].every(Number.isFinite) ||
        r.semiMajorAxisAU <= 0 || r.eccentricity < 0 || r.eccentricity >= 1 ||
        r.inclinationDeg < 0 || r.inclinationDeg > 180 || r.meanMotionDegPerDay <= 0) {
      throw new Error(`Invalid bound elliptic asteroid elements in row ${row}`)
    }
  }
  return records
}
