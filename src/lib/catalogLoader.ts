import { fetchImmutableArrayBuffer, fetchImmutableGzipJson, fetchImmutableJson } from '../data/cache/indexedDb'
import { catalogBatch, catalogForEachBounded, SharedCatalogCache } from '../data/cache/sharedCatalogCache'
import { CatalogHttpError, isMissingCatalogArtifact } from '../data/cache/catalogHttpError'
import { readBoundedStream } from '../data/cache/boundedStream'
import { bindDatasetProvenance } from './datasetProvenance'
import { bindCatalogSummary } from './catalogSummary'
import { bindCatalogChecksums, catalogSha256 } from './catalogIntegrity'
import type { CatalogChecksums } from './catalogIntegrity'
import { bindCatalogIndexRecord, validateCatalogMetadata, validateCatalogRecords } from './catalogRecordValidation'
import type {
  AsteroidIndexEntry,
  AsteroidManifest,
  AsteroidRecord,
  AsteroidSectionCursor,
  BodyId,
  CatalogSummary,
  CatalogSampleProfile,
  CelestialBody,
  DatasetProvenance,
  DatasetVersion,
  OrbitClassCode,
} from '../types'
import { CATALOG_DATA_ROOT } from './platform'
import { sceneAvailability } from './productAvailability'
import { requireCatalogAccess, requireProductAccess } from './productAccess'

export const dataRoot = CATALOG_DATA_ROOT
const PERMANENT_NUMBER_BUCKET_SIZE = 10_000
const MAX_SEARCH_BUCKET_CACHE_ENTRIES = 4
export const MAX_CHUNK_CACHE_ENTRIES = 8
export const MAX_LOOKUP_CACHE_ENTRIES = 8
/** Cached record fields are scalar. Freeze once before publication instead of
 * cloning entire shards for each consumer. Consumers needing edits must copy. */
function freezeCatalogRows<T extends AsteroidIndexEntry>(records: T[]): T[] {
  for (const record of records) Object.freeze(record)
  Object.freeze(records)
  return records
}
function freezeCatalogSummary(summary: CatalogSummary): CatalogSummary {
  Object.freeze(summary.categoryCounts)
  for (const range of Object.values(summary.numericRanges)) Object.freeze(range)
  Object.freeze(summary.numericRanges)
  return Object.freeze(summary)
}
// A deterministic retention weight, not a JS heap measurement. Catalog row
// fields are scalar; count string code units plus per-row/property allowances.
function catalogRowWeight(records: AsteroidIndexEntry[]): number {
  let weight = 64 + records.length * 8
  for (const record of records) {
    weight += 64
    for (const [key, value] of Object.entries(record)) {
      weight += 32 + key.length * 2 + (typeof value === 'string' ? value.length * 2 : 8)
    }
  }
  return weight
}
const rowCacheBudget = { maximumWeight: 32 * 1024 * 1024, weigh: catalogRowWeight }
const searchBucketCache = new SharedCatalogCache<AsteroidIndexEntry[]>(MAX_SEARCH_BUCKET_CACHE_ENTRIES, freezeCatalogRows, rowCacheBudget)
const chunkCache = new SharedCatalogCache<AsteroidRecord[]>(MAX_CHUNK_CACHE_ENTRIES, freezeCatalogRows, rowCacheBudget)
const lookupCache = new SharedCatalogCache<AsteroidIndexEntry[]>(MAX_LOOKUP_CACHE_ENTRIES, freezeCatalogRows, rowCacheBudget)
const sampleCache = new SharedCatalogCache<AsteroidRecord[]>(2, freezeCatalogRows, rowCacheBudget)
const summaryCache = new SharedCatalogCache<CatalogSummary>(2, freezeCatalogSummary, {
  maximumWeight: 1024 * 1024,
  weigh: summary => 256 + summary.sourceSha256.length * 2 +
    Object.keys(summary.categoryCounts).reduce((total, key) => total + 48 + key.length * 2, 0) +
    Object.keys(summary.numericRanges).reduce((total, key) => total + 96 + key.length * 2, 0),
})
const checksumCache = new SharedCatalogCache<CatalogChecksums>(2, value => value, {
  maximumWeight: 8 * 1024 * 1024, weigh: value => value.retainedWeight,
})
let activeManifest: AsteroidManifest | null = null
let manifestRequestGeneration = 0
const manifestCache = new SharedCatalogCache<{ manifest: AsteroidManifest; releaseRoot: string }>(4)

function catalogCacheKey(root: string, manifest: AsteroidManifest | null, ...artifact: unknown[]) {
  return JSON.stringify([root, manifest?.version ?? null, manifest?.contentSha256 ?? null,
    manifest?.sourceSha256 ?? null, manifest?.format ?? null, manifest?.capabilities ?? [], ...artifact])
}

function releaseManifestPath(version: string) {
  if (typeof version !== 'string' || !version.length || version.length > 256 || version === '.' || version === '..' ||
      /[\\/?#]/.test(version) || [...version].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('Invalid dataset release identity')
  return `releases/${encodeURIComponent(version)}/manifest.json`
}

function checkedVersionPointer(pointer: DatasetVersion | null) {
  if (!pointer || (pointer.schemaVersion !== 1 && pointer.schemaVersion !== 2) ||
      !['lite', 'full'].includes(pointer.mode)) throw new Error('Unsupported dataset version pointer')
  const path = releaseManifestPath(pointer.activeVersion)
  if (pointer.manifestPath !== path && pointer.manifestPath !== `releases/${pointer.activeVersion}/manifest.json`) {
    throw new Error('Dataset pointer path does not match its release identity')
  }
  for (const hash of [pointer.sourceSha256, pointer.contentSha256]) {
    if (hash !== undefined && (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid dataset pointer hash')
  }
  return path
}

async function fetchJson<T>(url: string, immutable = true, manifest = activeManifest, signal?: AbortSignal, expectedSha256?: string) {
  if (immutable) {
    const compressed = manifest?.capabilities?.includes('gzip-json-v1') && (
      /\/(search|lookup|meta|chunks)\/.+\.json$/.test(url) || /\/catalog-sample-(desktop|mobile)\.json$/.test(url)
    )
    return compressed ? fetchImmutableGzipJson<T>(`${url}.gz`, signal, expectedSha256) : fetchImmutableJson<T>(url, signal, expectedSha256)
  }
  signal?.throwIfAborted()
  const controller = new AbortController(), cancel = () => controller.abort(signal?.reason)
  const timeout = setTimeout(() => controller.abort(new DOMException('Dataset pointer read exceeded 30 seconds', 'TimeoutError')), 30_000)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (controller.signal.aborted || !response.ok || Number(response.headers.get('content-length')) > 1024*1024) {
      void response.body?.cancel().catch(() => undefined)
      controller.signal.throwIfAborted()
      if (!response.ok) throw new CatalogHttpError(url, response.status)
      throw new Error('Dataset pointer exceeds 1 MiB')
    }
    if (!response.body) throw new Error('Dataset pointer response is empty')
    const bytes = await readBoundedStream(response.body, 1024*1024, controller.signal)
    controller.signal.throwIfAborted()
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', cancel)
  }
}

async function loadCatalogChecksums(manifest: AsteroidManifest | null, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (!manifest || manifest.contentSha256 === undefined) return undefined
  const root = manifest.releasePath ?? dataRoot
  const checksum = await checksumCache.get(catalogCacheKey(root, manifest, 'checksums'), async requestSignal => {
    let report: unknown
    await fetchImmutableArrayBuffer(`${root}/checksums.json`, bytes => {
      if (bytes.byteLength > 2*1024*1024) throw new Error('Catalog checksum map exceeds 2 MiB')
      report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    }, requestSignal)
    return bindCatalogChecksums(report, manifest, requestSignal)
  }, signal)
  signal?.throwIfAborted()
  return checksum
}

async function artifactHash(path: string, manifest: AsteroidManifest | null, signal?: AbortSignal) {
  return (await loadCatalogChecksums(manifest, signal))?.(path)
}

/** The producer emits occupied search/lookup buckets only. Absence in a bound
 * descriptor is an empty bucket; a declared file returning 404 is a failure. */
async function fetchCatalogIndexBucket(kind: 'search' | 'lookup', bucket: string, manifest: AsteroidManifest, signal: AbortSignal) {
  const path = `${kind}/${encodeURIComponent(bucket)}.json`
  const checksums = await loadCatalogChecksums(manifest, signal)
  let records: AsteroidIndexEntry[]
  if (checksums && !checksums.has(path)) records = []
  else records = await fetchJson<AsteroidIndexEntry[]>(`${manifest.releasePath ?? dataRoot}/${path}`, true, manifest, signal, checksums?.(path))
  validateCatalogMetadata(records)
  if (kind === 'search' && checksums) {
    const counts = manifest.bucketCounts
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) throw new Error('Invalid catalog search bucket counts')
    const expected = Object.hasOwn(counts, bucket) ? counts[bucket] : 0
    if (!Number.isSafeInteger(expected) || expected < 0 || records.length !== expected) throw new Error('Search bucket differs from manifest count')
  }
  if (kind === 'lookup' && records.some(record => idLookupBucket(record.id) !== bucket)) throw new Error('Catalog identity is in the wrong lookup bucket')
  return records
}

async function fetchCatalogJson<T>(path: string, manifest: AsteroidManifest | null, signal?: AbortSignal) {
  const expectedHash = await artifactHash(path, manifest, signal)
  return fetchJson<T>(`${manifest?.releasePath ?? dataRoot}/${path}`, true, manifest, signal, expectedHash)
}

async function fetchCatalogBinary(path: string, manifest: AsteroidManifest | null, signal?: AbortSignal) {
  const expectedHash = await artifactHash(path, manifest, signal)
  return fetchImmutableArrayBuffer(`${manifest?.releasePath ?? dataRoot}/${path}`, async bytes => {
    if (expectedHash !== undefined && await catalogSha256(bytes) !== expectedHash) throw new Error('Catalog binary SHA-256 mismatch')
    signal?.throwIfAborted()
    validateBinaryElements(bytes)
  }, signal)
}

export function normalizeSearchText(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').trim()
}

export function getSearchBucketKey(searchText: string, tokenPrefixLength = activeManifest?.searchIndex?.tokenPrefixLength ?? 1) {
  const packedExtended = searchText.trim().match(/^~([0-9A-Za-z]{4})/)
  if (packedExtended) return `packed-tilde-${packedExtended[1][0].toLowerCase()}`
  const normalized = normalizeSearchText(searchText)
  if (!normalized) return 'misc'
  const provisionalYear = normalized.match(/^(\d{4})\s+[a-z]/)?.[1]
  if (provisionalYear) {
    const year = Number(provisionalYear)
    if (year >= 1800 && year <= 2199) return `year-${provisionalYear}`
  }
  const permanentNumber = normalized.match(/^(\d+)(?:\s|$)/)?.[1]
  if (permanentNumber) return getPermanentNumberBucketKey(Number(permanentNumber))
  if (/[a-z]/.test(normalized[0])) {
    const token = normalized.split(' ')[0]
    return tokenPrefixLength >= 2 && token.length >= 2 ? `prefix-${token.slice(0, tokenPrefixLength)}` : normalized[0]
  }
  return 'misc'
}

export function getPermanentNumberBucketKey(permanentNumber: number) {
  if (!Number.isSafeInteger(permanentNumber) || permanentNumber < 0) return 'number-misc'
  const start = Math.floor(permanentNumber / PERMANENT_NUMBER_BUCKET_SIZE) * PERMANENT_NUMBER_BUCKET_SIZE
  const end = start + PERMANENT_NUMBER_BUCKET_SIZE - 1
  return `number-${String(start).padStart(6, '0')}-${String(end).padStart(6, '0')}`
}

function getLegacyNumericBucketKey(bucketKey: string) {
  if (bucketKey.startsWith('packed-tilde-')) {
    const firstCharacter = bucketKey.slice('packed-tilde-'.length)[0]
    if (!firstCharacter) return null
    return /\d/.test(firstCharacter) ? `digit-${firstCharacter}` : firstCharacter
  }
  const numericPart = bucketKey.startsWith('year-')
    ? bucketKey.slice('year-'.length)
    : bucketKey.startsWith('number-')
      ? bucketKey.slice('number-'.length).split('-')[0]
      : ''
  const firstSignificantDigit = numericPart.replace(/^0+/, '')[0] ?? '0'
  return numericPart ? `digit-${firstSignificantDigit}` : null
}

export function resetDatasetLoader() {
  activeManifest = null
  manifestRequestGeneration += 1
  manifestCache.clear()
  searchBucketCache.clear()
  chunkCache.clear()
  lookupCache.clear()
  sampleCache.clear()
  summaryCache.clear()
  checksumCache.clear()
}

export function isNameSearchTooShort(searchText: string, manifest = activeManifest) {
  const requiredLength = manifest?.searchIndex?.tokenPrefixLength ?? 1
  const normalized = normalizeSearchText(searchText)
  return requiredLength >= 2 && /^[a-z]$/.test(normalized)
}

export async function loadAsteroidManifest(requestedVersion?: string) {
  requireProductAccess(sceneAvailability({ dataset: requestedVersion }))
  const generation = manifestRequestGeneration + 1
  manifestRequestGeneration = generation
  // An actual release named "current" must not alias the unpinned pointer.
  const cacheKey = JSON.stringify([requestedVersion ?? null])
  const loaded = await manifestCache.get(cacheKey, async signal => {
      let manifestPath: string
      let versionPointer: DatasetVersion | null = null
      if (requestedVersion) {
        manifestPath = releaseManifestPath(requestedVersion)
      } else {
        let pointerMissing = false
        try {
          versionPointer = await fetchJson<DatasetVersion>(`${dataRoot}/dataset-version.json`, false, null, signal)
        } catch (error) {
          if (!isMissingCatalogArtifact(error)) throw error
          pointerMissing = true
          // Legacy v1 datasets only exposed manifest.json.
        }
        manifestPath = pointerMissing ? 'manifest.json' : checkedVersionPointer(versionPointer)
      }
      const normalizedPath = manifestPath
      const manifestUrl = `${dataRoot}/${normalizedPath}`
      const manifest = await fetchJson<AsteroidManifest>(manifestUrl, true, null, signal)
      if (requestedVersion && manifest.version !== requestedVersion) throw new Error('Requested dataset version does not match its manifest')
      if (versionPointer && (manifest.version !== versionPointer.activeVersion || manifest.datasetMode !== versionPointer.mode ||
          versionPointer.sourceSha256 !== undefined && manifest.sourceSha256 !== versionPointer.sourceSha256 ||
          versionPointer.contentSha256 !== undefined && manifest.contentSha256 !== versionPointer.contentSha256)) {
        throw new Error('Dataset manifest does not match its version pointer')
      }
      const slash = normalizedPath.lastIndexOf('/')
      const releaseRoot = slash >= 0 ? `${dataRoot}/${normalizedPath.slice(0, slash)}` : dataRoot
      return { manifest: { ...manifest, releasePath: releaseRoot }, releaseRoot }
  }).catch(() => null)
  const manifest = loaded ? structuredClone(loaded.manifest) : null
  if (generation !== manifestRequestGeneration) return manifest
  activeManifest = manifest ? structuredClone(manifest) : null
  return manifest
}

export async function loadDatasetProvenance(requestedManifest?: AsteroidManifest, signal?: AbortSignal): Promise<DatasetProvenance | null> {
  signal?.throwIfAborted()
  if (!requestedManifest && !activeManifest) await loadAsteroidManifest()
  signal?.throwIfAborted()
  const source = requestedManifest ?? activeManifest
  const manifest = source ? structuredClone(source) : null
  if (!manifest) return null
  let provenance: DatasetProvenance
  try {
    provenance = await fetchJson<DatasetProvenance>(`${manifest.releasePath ?? dataRoot}/provenance.json`, true, manifest, signal)
  } catch (error) {
    signal?.throwIfAborted()
    if (!isMissingCatalogArtifact(error)) throw error
    return {
      recordOrigin: 'manifest-derived',
      datasetVersion: manifest.version,
      source: manifest.source,
      sourceLastModifiedAt: manifest.sourceLastModifiedAt ?? manifest.sourceDownloadedAt ?? manifest.generatedAt,
      downloadedAt: manifest.sourceDownloadedAt,
      generatedAt: manifest.generatedAt,
      sourceSha256: manifest.sourceSha256 ?? 'not recorded (legacy dataset)',
      contentSha256: manifest.contentSha256,
      parserVersion: manifest.parserVersion ?? 'legacy-v1',
      parserCommit: manifest.parserCommit,
      selectionPolicy: manifest.selectionPolicy,
      totalObjects: manifest.totalCount,
      mode: manifest.datasetMode ?? 'lite',
      orbitModel: manifest.orbitModel ?? 'two-body osculating elements',
      precision: manifest.precision ?? 'educational',
    }
  }
  signal?.throwIfAborted()
  return bindDatasetProvenance(provenance, manifest)
}

export function loadAsteroidSearchBucket(bucketKey: string, manifest = activeManifest, signal?: AbortSignal) {
  requireCatalogAccess('search')
  manifest = manifest ? structuredClone(manifest) : null
  const normalizedBucket = bucketKey || 'misc'
  const releaseRoot = manifest?.releasePath ?? dataRoot
  const cacheKey = catalogCacheKey(releaseRoot, manifest, normalizedBucket)
  if (manifest?.contentSha256 !== undefined) {
    const capturedManifest = manifest
    const counts = manifest.bucketCounts
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return Promise.reject<AsteroidIndexEntry[]>(new Error('Invalid catalog search bucket counts'))
    const expectedCount = Object.hasOwn(counts, normalizedBucket) ? counts[normalizedBucket] : 0
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) return Promise.reject<AsteroidIndexEntry[]>(new Error('Invalid catalog search bucket count'))
    return searchBucketCache.get(catalogCacheKey(releaseRoot, manifest, normalizedBucket, expectedCount),
      requestSignal => fetchCatalogIndexBucket('search', normalizedBucket, capturedManifest, requestSignal), signal)
  }
  return searchBucketCache.get(cacheKey, requestSignal => fetchJson<AsteroidIndexEntry[]>(
    `${releaseRoot}/search/${encodeURIComponent(normalizedBucket)}.json`,
    true, manifest, requestSignal,
  ).catch(async (error: unknown) => {
    requestSignal.throwIfAborted()
    if (!isMissingCatalogArtifact(error)) throw error
    if (normalizedBucket.startsWith('prefix-')) {
      const legacyInitial = normalizedBucket.slice('prefix-'.length)[0]
      if (legacyInitial) {
        return fetchJson<AsteroidIndexEntry[]>(`${releaseRoot}/search/${encodeURIComponent(legacyInitial)}.json`, true, manifest, requestSignal)
      }
    }
    const legacyBucket = getLegacyNumericBucketKey(normalizedBucket)
    if (!legacyBucket) throw error
    return fetchJson<AsteroidIndexEntry[]>(
      `${releaseRoot}/search/${encodeURIComponent(legacyBucket)}.json`,
      true, manifest, requestSignal,
    ).catch((error: unknown) => {
      requestSignal.throwIfAborted()
      if (!isMissingCatalogArtifact(error)) throw error
      return fetchJson<AsteroidIndexEntry[]>(`${releaseRoot}/search/digit.json`, true, manifest, requestSignal)
    })
  }).then(records => { validateCatalogMetadata(records); return records }), signal)
}

export function validateBinaryElements(buffer: ArrayBuffer, startRow = 0, endRow = buffer.byteLength / 64) {
  if (buffer.byteLength % 64 !== 0) throw new Error('Invalid binary asteroid element stride')
  if (!Number.isSafeInteger(startRow) || !Number.isSafeInteger(endRow) || startRow < 0 || endRow < startRow || endRow > buffer.byteLength/64) throw new Error('Invalid binary asteroid validation range')
  const values = new Float64Array(buffer)
  for (let offset = startRow*8; offset < endRow*8; offset += 8) {
    for (let field = 0; field < 8; field++) {
      if (!Number.isFinite(values[offset + field])) throw new Error(`Non-finite asteroid element in row ${offset / 8}`)
    }
    if (values[offset + 1] <= 0 || values[offset + 2] < 0 || values[offset + 2] >= 1 ||
        values[offset + 3] < 0 || values[offset + 3] > 180 || values[offset + 7] <= 0) {
      throw new Error(`Invalid bound elliptic asteroid elements in row ${offset / 8}`)
    }
  }
}

function decodeBinaryChunk(metadata: AsteroidIndexEntry[], buffer: ArrayBuffer, chunkId?: string) {
  validateCatalogMetadata(metadata, chunkId)
  const match = chunkId === undefined ? null : /^chunk-(\d{4,})$/.exec(chunkId)
  const chunkIndex = chunkId === undefined ? undefined : match ? Number(match[1]) : NaN
  if (chunkIndex !== undefined && (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || getChunkIdFromIndex(chunkIndex) !== chunkId)) throw new Error('Invalid binary asteroid chunk identity')
  const values = new Float64Array(buffer)
  const stride = 8
  if (values.length !== metadata.length * stride) {
    throw new Error(`Binary asteroid shard has ${values.length} values; expected ${metadata.length * stride}`)
  }
  return metadata.map<AsteroidRecord>((entry, index) => {
    if (chunkId !== undefined && (entry.chunkId !== chunkId || entry.chunkIndex !== undefined && entry.chunkIndex !== chunkIndex ||
        entry.rowIndex !== undefined && entry.rowIndex !== index)) throw new Error('Asteroid metadata locator does not match its binary row')
    const offset = index * stride
    return {
      ...entry,
      // Samples may mix source shards; their sample offset is not a source row.
      ...(chunkIndex === undefined ? {} : { chunkIndex, rowIndex: index }),
      epochJd: values[offset],
      semiMajorAxisAU: values[offset + 1],
      eccentricity: values[offset + 2],
      inclinationDeg: values[offset + 3],
      ascendingNodeDeg: values[offset + 4],
      argPeriapsisDeg: values[offset + 5],
      meanAnomalyDeg: values[offset + 6],
      meanMotionDegPerDay: values[offset + 7],
    }
  })
}

export function loadAsteroidChunk(chunkId: string, manifest = activeManifest, signal?: AbortSignal) {
  requireCatalogAccess('details')
  manifest = manifest ? structuredClone(manifest) : null
  const root = manifest?.releasePath ?? dataRoot
  const cacheKey = catalogCacheKey(root, manifest, chunkId)
  return chunkCache.get(cacheKey, requestSignal => catalogBatch(requestSignal, batchSignal => manifest?.format === 'binary-v1'
    ? Promise.all([
        fetchCatalogJson<AsteroidIndexEntry[]>(`meta/${encodeURIComponent(chunkId)}.json`, manifest, batchSignal),
        fetchCatalogBinary(`binary/${encodeURIComponent(chunkId)}.bin`, manifest, batchSignal),
      ]).then(([metadata, buffer]) => decodeBinaryChunk(metadata, buffer, chunkId))
    : fetchJson<AsteroidRecord[]>(`${root}/chunks/${encodeURIComponent(chunkId)}.json`, true, manifest, batchSignal).then(records => validateCatalogRecords(records, chunkId))), signal)
}

async function loadIndexedCatalogRecords(entries: AsteroidIndexEntry[], manifest: AsteroidManifest | null, signal?: AbortSignal) {
  const groups = new Map<string, { entry: AsteroidIndexEntry; outputIndex: number }[]>()
  entries.forEach((entry, outputIndex) => {
    const group = groups.get(entry.chunkId) ?? []
    if (!groups.has(entry.chunkId)) groups.set(entry.chunkId, group)
    group.push({ entry, outputIndex })
  })
  const records = new Array<AsteroidRecord>(entries.length)
  await catalogForEachBounded([...groups], signal, async ([chunkId, requested], batchSignal) => {
    const chunk = await loadAsteroidChunk(chunkId, manifest, batchSignal)
    // One temporary row map per active shard, released with this callback.
    const rowsById = new Map(chunk.map((record, row) => [record.id, row] as const))
    for (const { entry, outputIndex } of requested) {
      const row = rowsById.get(entry.id)
      records[outputIndex] = bindCatalogIndexRecord(entry, row === undefined ? undefined : chunk[row], row ?? -1)
    }
  })
  return records
}

export async function searchAsteroidCatalogPage(params: {
  query: string
  manifest?: AsteroidManifest | null
  cursor?: number
  pageSize?: number
  maximumChunks?: number
  signal?: AbortSignal
}) {
  const { query, signal, cursor = 0, pageSize = 1_200, maximumChunks = 30 } = params
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_200 ||
      !Number.isSafeInteger(maximumChunks) || maximumChunks < 1 || maximumChunks > 30) {
    throw new RangeError('Catalog search requires a nonnegative integer cursor, 1–1200 records and 1–30 chunks per page')
  }
  const sourceManifest = params.manifest === undefined ? activeManifest : params.manifest
  const manifest = sourceManifest ? structuredClone(sourceManifest) : null
  const normalized = normalizeSearchText(query)
  if (!normalized) return { records: [], total: 0, nextCursor: null as number | null }
  if (isNameSearchTooShort(query, manifest)) return { records: [], total: 0, nextCursor: null as number | null }
  const entries = await loadAsteroidSearchBucket(getSearchBucketKey(query, manifest?.searchIndex?.tokenPrefixLength), manifest, signal)
  const selected: AsteroidIndexEntry[] = []
  const chunkIds = new Set<string>()
  let total = 0
  let nextCursor: number | null = null
  for (const entry of entries) {
    if (!entry.searchKey.includes(normalized)) continue
    if (total >= cursor && selected.length < pageSize) {
      if (nextCursor === null) {
        if (!chunkIds.has(entry.chunkId) && chunkIds.size >= maximumChunks) {
          nextCursor = total
        } else {
          chunkIds.add(entry.chunkId)
          selected.push(entry)
        }
      }
    }
    total += 1
  }
  if (nextCursor === null && cursor + selected.length < total) nextCursor = cursor + selected.length
  const records = await loadIndexedCatalogRecords(selected, manifest, signal)
  return { records, total, nextCursor }
}

function idLookupBucket(id: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).slice(-2).padStart(2, '0')
}

export async function loadAsteroidBodiesByIds(ids: BodyId[], signal?: AbortSignal, requestedManifest = activeManifest) {
  if (ids.length) requireCatalogAccess('details')
  const asteroidIds = [...new Set(ids.filter((id) => id.startsWith('asteroid:')))]
  const manifest = requestedManifest ? structuredClone(requestedManifest) : null
  if (!asteroidIds.length || !manifest || (manifest.schemaVersion ?? 1) < 2) return []
  const root = manifest.releasePath ?? dataRoot
  const groups = new Map<string, BodyId[]>()
  for (const id of asteroidIds) {
    const bucket = idLookupBucket(id)
    const group = groups.get(bucket) ?? []
    if (!groups.has(bucket)) groups.set(bucket, group)
    group.push(id)
  }
  const matchedEntries: AsteroidIndexEntry[] = []
  return catalogBatch(signal, async batchSignal => {
    await catalogForEachBounded([...groups], batchSignal, async ([bucket, bucketIds], signal) => {
      const cacheKey = catalogCacheKey(root, manifest, bucket)
      const entries = await lookupCache.get(cacheKey, requestSignal =>
        fetchCatalogIndexBucket('lookup', bucket, manifest, requestSignal), signal)
      const wanted = new Set(bucketIds)
      for (const entry of entries) if (wanted.has(entry.id)) matchedEntries.push(entry)
    })
    const resolved = await loadIndexedCatalogRecords(matchedEntries, manifest, batchSignal)
    const records = new Map(resolved.map(record => [record.id, record] as const))
    return asteroidIds.flatMap(id => { const record = records.get(id); return record ? [asteroidRecordToBody(record)] : [] })
  })
}

export function loadAsteroidSample(manifest: AsteroidManifest, size: CatalogSampleProfile, signal?: AbortSignal) {
  manifest = structuredClone(manifest)
  const allowed = sceneAvailability({ catalogSample: size, catalogSampleCount: manifest.precomputedSamples?.[size]?.count })
  if (!allowed.available) {
    try { requireProductAccess(allowed) } catch (error) { return Promise.reject<AsteroidRecord[]>(error) }
  }
  const artifact = manifest.precomputedSamples?.[size]
  if (!artifact) return Promise.resolve<AsteroidRecord[]>([])
  const root = manifest.releasePath ?? dataRoot
  const cacheKey = catalogCacheKey(root, manifest, size, artifact.metadataPath, artifact.binaryPath, artifact.count)
  return sampleCache.get(cacheKey, requestSignal => catalogBatch(requestSignal, batchSignal => Promise.all([
    fetchCatalogJson<AsteroidIndexEntry[]>(artifact.metadataPath, manifest, batchSignal),
    fetchCatalogBinary(artifact.binaryPath, manifest, batchSignal),
  ]).then(([metadata, buffer]) => {
    const values = new Float64Array(buffer)
    if (metadata.length !== artifact.count || values.length !== artifact.count * 8) {
      throw new Error(`Precomputed ${size} sample does not match its manifest count`)
    }
    return decodeBinaryChunk(metadata, buffer)
  })), signal)
}

export function loadCatalogSummary(manifest: AsteroidManifest, signal?: AbortSignal) {
  manifest = structuredClone(manifest)
  if (!manifest.summaryPath) return Promise.resolve<CatalogSummary | null>(null)
  const root = manifest.releasePath ?? dataRoot
  const cacheKey = catalogCacheKey(root, manifest, manifest.summaryPath, manifest.totalCount, manifest.datasetMode, manifest.categoryCounts)
  return summaryCache.get(cacheKey, requestSignal =>
    fetchCatalogJson<CatalogSummary>(manifest.summaryPath!, manifest, requestSignal).then(summary => bindCatalogSummary(summary, manifest)), signal).catch((error: unknown) => {
    signal?.throwIfAborted()
    if (manifest.contentSha256 !== undefined || !isMissingCatalogArtifact(error)) throw error
    return null
  })
}

export async function loadAsteroidRecordsByLocators(manifest: AsteroidManifest, locators: Uint32Array, signal?: AbortSignal) {
  manifest = structuredClone(manifest)
  if (locators.length) requireCatalogAccess('details')
  if (locators.length % 2 !== 0) throw new Error('Catalog locator array must contain chunk/row pairs')
  const groups = new Map<number, { rowIndex: number; outputIndex: number }[]>()
  for (let index = 0; index < locators.length; index += 2) {
    const chunkIndex = locators[index]
    const rowIndex = locators[index + 1]
    if (chunkIndex >= manifest.chunkCount || rowIndex >= manifest.chunkSize) {
      throw new Error(`Catalog locator is outside the declared dataset: ${chunkIndex}:${rowIndex}`)
    }
    const group = groups.get(chunkIndex) ?? []
    if (!groups.has(chunkIndex)) groups.set(chunkIndex, group)
    group.push({ rowIndex, outputIndex: index / 2 })
  }
  const records = new Array<AsteroidRecord>(locators.length / 2)
  await catalogForEachBounded([...groups], signal, async ([chunkIndex, requestedRows], batchSignal) => {
    const chunk = await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex), manifest, batchSignal)
    for (const { rowIndex, outputIndex } of requestedRows) {
      const record = chunk[rowIndex]
      if (!record) throw new Error(`Catalog locator does not resolve to a record: ${chunkIndex}:${rowIndex}`)
      records[outputIndex] = record
    }
  })
  return records
}

export async function loadAsteroidSearchLocators(query: string, manifest: AsteroidManifest, signal?: AbortSignal) {
  manifest = structuredClone(manifest)
  if (!manifest.searchIndex?.locators) return null
  const normalized = normalizeSearchText(query)
  if (!normalized) return null
  if (isNameSearchTooShort(query, manifest)) return new Uint32Array(0)
  const { chunkCount, chunkSize, totalCount } = manifest
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 0 || chunkCount > 0x100000000 ||
      !Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 0x100000000 ||
      !Number.isSafeInteger(totalCount) || totalCount < 0 || chunkCount !== Math.ceil(totalCount/chunkSize)) throw new Error('Invalid catalog search locator dimensions')
  const entries = await loadAsteroidSearchBucket(getSearchBucketKey(query, manifest.searchIndex.tokenPrefixLength), manifest, signal)
  const matched = entries.filter((entry) => entry.searchKey.includes(normalized))
  // Missing locators are supported by legacy search buckets. Present but
  // malformed values must not wrap/truncate into a different Uint32 source row.
  let missingLocator = false
  for (const entry of matched) {
    if (entry.chunkIndex === undefined || entry.rowIndex === undefined) missingLocator = true
    if (entry.chunkIndex !== undefined && (!Number.isSafeInteger(entry.chunkIndex) || entry.chunkIndex < 0 ||
        entry.chunkIndex >= chunkCount || entry.chunkIndex > 0xffffffff || entry.chunkId !== getChunkIdFromIndex(entry.chunkIndex)) ||
        entry.rowIndex !== undefined && (!Number.isSafeInteger(entry.rowIndex) || entry.rowIndex < 0 ||
        entry.rowIndex >= chunkSize || entry.rowIndex > 0xffffffff)) {
      throw new Error('Catalog search locator does not match its source chunk and row')
    }
  }
  if (missingLocator) return null
  // Keep identity evidence until the search index has been joined to the
  // declared source metadata. Workers receive only packed positions, so after
  // this point they cannot detect an index pointing at a different body.
  const groups = new Map<number, AsteroidIndexEntry[]>()
  for (const entry of matched) {
    if (entry.chunkIndex!*chunkSize+entry.rowIndex! >= totalCount) throw new Error('Catalog search locator exceeds total source rows')
    const group = groups.get(entry.chunkIndex!) ?? []
    if (!groups.has(entry.chunkIndex!)) groups.set(entry.chunkIndex!, group)
    group.push(entry)
  }
  await catalogForEachBounded([...groups], signal, async ([chunkIndex, entries], batchSignal) => {
    const id = getChunkIdFromIndex(chunkIndex)
    const metadata = manifest.format === 'binary-v1'
      ? await fetchCatalogJson<AsteroidIndexEntry[]>(`meta/${id}.json`, manifest, batchSignal)
      : await loadAsteroidChunk(id, manifest, batchSignal)
    validateCatalogMetadata(metadata, id)
    if (metadata.length !== Math.min(chunkSize, totalCount-chunkIndex*chunkSize)) throw new Error('Catalog search source shard count differs from manifest')
    const rows = new Set<number>()
    for (const entry of entries) {
      const row = entry.rowIndex!
      if (rows.has(row)) throw new Error('Duplicate catalog search source locator')
      rows.add(row)
      bindCatalogIndexRecord(entry, metadata[row], row)
    }
  })
  signal?.throwIfAborted()
  const locators = new Uint32Array(matched.length * 2)
  matched.forEach((entry, index) => {
    locators[index * 2] = entry.chunkIndex!
    locators[index * 2 + 1] = entry.rowIndex!
  })
  return locators
}

function getChunkIdFromIndex(index: number) {
  return `chunk-${String(index).padStart(4, '0')}`
}

function filterChunkByOrbitClass(chunk: AsteroidRecord[], orbitClassCode: string) {
  return orbitClassCode === 'all' ? chunk : chunk.filter((record) => record.orbitClassCode === orbitClassCode)
}

function getOrbitClassName(code: OrbitClassCode) {
  const names: Record<string, string> = {
    MBA: 'Main-belt Asteroid', TNO: 'Trans-Neptunian Object', APO: 'Apollo',
    ATE: 'Aten', AMO: 'Amor', ATI: 'Atira', MCR: 'Object with q < 1.665 AU',
    HIL: 'Hilda', JTA: 'Jupiter Trojan', HUN: 'Hungaria', OTHER: 'Other or unknown orbit type',
  }
  return names[code] ?? 'Other small body'
}

export function asteroidRecordToBody(record: AsteroidRecord): CelestialBody {
  return {
    id: record.id,
    name: record.label,
    shortName: record.shortLabel,
    kind: record.id.startsWith('dwarf:') ? 'dwarfPlanet' : 'asteroid',
    color: record.isPha ? '#ff685d' : record.isNeo ? '#ff9f7f' : record.orbitClassCode === 'TNO' ? '#b9a8ff' : '#b8c9d9',
    size: record.id.startsWith('dwarf:') ? 4.2 : 2.1,
    source: 'mpcorb',
    naifId: Number.isSafeInteger(record.permanentNumber) && record.permanentNumber! > 0 && record.permanentNumber! < 1000000
      ? 2000000 + record.permanentNumber! : undefined,
    orbitClassCode: record.orbitClassCode,
    orbitClassName: record.orbitClassName || getOrbitClassName(record.orbitClassCode),
    absoluteMagnitude: record.absoluteMagnitude,
    dataEpochLabel: `JD ${record.epochJd} TT (MPCORB)`,
    isCatalogBody: true,
    orbit: {
      model: 'keplerian',
      epochJd: record.epochJd,
      epochTimeScale: 'TT',
      semiMajorAxisAU: record.semiMajorAxisAU,
      eccentricity: record.eccentricity,
      inclinationDeg: record.inclinationDeg,
      ascendingNodeDeg: record.ascendingNodeDeg,
      argPeriapsisDeg: record.argPeriapsisDeg,
      meanAnomalyDeg: record.meanAnomalyDeg,
      meanMotionDegPerDay: record.meanMotionDegPerDay,
    },
  }
}

export function getBodyIds(records: AsteroidRecord[]): BodyId[] {
  return records.map((record) => record.id)
}

export async function loadAsteroidSectionPage(params: {
  manifest: AsteroidManifest
  orbitClassCode: string
  cursor?: AsteroidSectionCursor
  pageSize: number
  signal?: AbortSignal
}) {
  const { orbitClassCode, pageSize } = params
  const manifest = structuredClone(params.manifest)
  const startCursor = params.cursor ? { ...params.cursor } : { chunkIndex: 0, recordOffset: 0 }
  let chunkIndex = startCursor.chunkIndex
  let recordOffset = startCursor.recordOffset
  const records: AsteroidRecord[] = []
  while (chunkIndex < manifest.chunkCount && records.length < pageSize) {
    const chunk = await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex), manifest, params.signal)
    const filtered = filterChunkByOrbitClass(chunk, orbitClassCode)
    const slice = filtered.slice(recordOffset, recordOffset + pageSize - records.length)
    records.push(...slice)
    if (recordOffset + slice.length < filtered.length) {
      return { records, startCursor, endCursor: { chunkIndex, recordOffset: recordOffset + slice.length } }
    }
    chunkIndex += 1
    recordOffset = 0
  }
  return { records, startCursor, endCursor: { chunkIndex, recordOffset: 0 } }
}

export async function loadAsteroidSectionPreviousPage(params: {
  manifest: AsteroidManifest
  orbitClassCode: string
  cursor: AsteroidSectionCursor
  pageSize: number
  signal?: AbortSignal
}) {
  const { orbitClassCode, pageSize } = params
  const manifest = structuredClone(params.manifest), cursor = { ...params.cursor }
  const records: AsteroidRecord[] = []
  if (manifest.chunkCount === 0) return { records, startCursor: { chunkIndex: 0, recordOffset: 0 }, endCursor: cursor }
  let chunkIndex = Math.min(cursor.chunkIndex, manifest.chunkCount - 1)
  let recordOffset = cursor.chunkIndex >= manifest.chunkCount ? 0 : cursor.recordOffset
  if (cursor.chunkIndex >= manifest.chunkCount) {
    recordOffset = filterChunkByOrbitClass(await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex), manifest, params.signal), orbitClassCode).length
  }
  while (chunkIndex >= 0 && records.length < pageSize) {
    const filtered = filterChunkByOrbitClass(await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex), manifest, params.signal), orbitClassCode)
    const available = filtered.slice(0, recordOffset)
    const sliceStart = Math.max(available.length - (pageSize - records.length), 0)
    records.unshift(...available.slice(sliceStart))
    if (sliceStart > 0) return { records, startCursor: { chunkIndex, recordOffset: sliceStart }, endCursor: cursor }
    chunkIndex -= 1
    if (chunkIndex >= 0) {
      recordOffset = filterChunkByOrbitClass(await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex), manifest, params.signal), orbitClassCode).length
    }
  }
  return { records, startCursor: { chunkIndex: 0, recordOffset: 0 }, endCursor: cursor }
}
