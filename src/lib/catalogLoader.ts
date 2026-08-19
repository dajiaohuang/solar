import { fetchImmutableArrayBuffer, fetchImmutableJson } from '../data/cache/indexedDb'
import type {
  AsteroidIndexEntry,
  AsteroidManifest,
  AsteroidRecord,
  AsteroidSectionCursor,
  BodyId,
  CatalogSummary,
  CelestialBody,
  DatasetProvenance,
  DatasetVersion,
  OrbitClassCode,
} from '../types'

const BASE = import.meta.env.BASE_URL
const dataRoot = `${BASE}data/asteroids`
const searchBucketCache = new Map<string, Promise<AsteroidIndexEntry[]>>()
const chunkCache = new Map<string, Promise<AsteroidRecord[]>>()
const lookupCache = new Map<string, Promise<AsteroidIndexEntry[]>>()
const sampleCache = new Map<string, Promise<AsteroidRecord[]>>()
const summaryCache = new Map<string, Promise<CatalogSummary | null>>()
const PERMANENT_NUMBER_BUCKET_SIZE = 10_000
const MAX_SEARCH_BUCKET_CACHE_ENTRIES = 4
export const MAX_CHUNK_CACHE_ENTRIES = 8
let activeManifest: AsteroidManifest | null = null
let activeReleaseRoot = dataRoot
let manifestRequestGeneration = 0
const manifestPromises = new Map<string, Promise<{ manifest: AsteroidManifest; releaseRoot: string } | null>>()

async function fetchJson<T>(url: string, immutable = true) {
  if (immutable) return fetchImmutableJson<T>(url)
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`)
  return response.json() as Promise<T>
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
  activeReleaseRoot = dataRoot
  manifestRequestGeneration += 1
  manifestPromises.clear()
  searchBucketCache.clear()
  chunkCache.clear()
  lookupCache.clear()
  sampleCache.clear()
  summaryCache.clear()
}

export async function loadAsteroidManifest(requestedVersion?: string) {
  const generation = manifestRequestGeneration + 1
  manifestRequestGeneration = generation
  const cacheKey = requestedVersion ?? 'current'
  let manifestPromise = manifestPromises.get(cacheKey)
  if (!manifestPromise) {
    manifestPromise = (async () => {
    try {
      let manifestPath: string
      if (requestedVersion) {
        manifestPath = `releases/${encodeURIComponent(requestedVersion)}/manifest.json`
      } else {
        let versionPointer: DatasetVersion | null = null
        try {
          versionPointer = await fetchJson<DatasetVersion>(`${dataRoot}/dataset-version.json`, false)
        } catch {
          // Legacy v1 datasets only exposed manifest.json.
        }
        manifestPath = versionPointer?.manifestPath ?? 'manifest.json'
      }
      const normalizedPath = manifestPath.replace(/^\/+/, '')
      const manifestUrl = `${dataRoot}/${normalizedPath}`
      const manifest = await fetchJson<AsteroidManifest>(manifestUrl)
      const slash = normalizedPath.lastIndexOf('/')
      const releaseRoot = slash >= 0 ? `${dataRoot}/${normalizedPath.slice(0, slash)}` : dataRoot
      return { manifest: { ...manifest, releasePath: releaseRoot }, releaseRoot }
    } catch {
      return null
    }
    })()
    manifestPromises.set(cacheKey, manifestPromise)
    void manifestPromise.then((loaded) => {
      if (!loaded && manifestPromises.get(cacheKey) === manifestPromise) manifestPromises.delete(cacheKey)
    })
  }
  const loaded = await manifestPromise
  if (generation !== manifestRequestGeneration) return loaded?.manifest ?? null
  activeManifest = loaded?.manifest ?? null
  activeReleaseRoot = loaded?.releaseRoot ?? dataRoot
  return activeManifest
}

export async function loadDatasetProvenance(): Promise<DatasetProvenance | null> {
  if (!activeManifest) await loadAsteroidManifest()
  if (!activeManifest) return null
  try {
    return await fetchJson<DatasetProvenance>(`${activeReleaseRoot}/provenance.json`)
  } catch {
    return {
      datasetVersion: activeManifest.version,
      source: activeManifest.source,
      downloadedAt: activeManifest.sourceDownloadedAt ?? activeManifest.generatedAt,
      generatedAt: activeManifest.generatedAt,
      sourceSha256: activeManifest.sourceSha256 ?? 'not recorded (legacy dataset)',
      contentSha256: activeManifest.contentSha256,
      parserVersion: activeManifest.parserVersion ?? 'legacy-v1',
      parserCommit: activeManifest.parserCommit,
      selectionPolicy: activeManifest.selectionPolicy,
      totalObjects: activeManifest.totalCount,
      mode: activeManifest.datasetMode ?? 'lite',
      orbitModel: activeManifest.orbitModel ?? 'two-body osculating elements',
      precision: activeManifest.precision ?? 'educational',
    }
  }
}

export function loadAsteroidSearchBucket(bucketKey: string) {
  const normalizedBucket = bucketKey || 'misc'
  const cacheKey = `${activeManifest?.version ?? 'legacy'}:${normalizedBucket}`
  const existing = searchBucketCache.get(cacheKey)
  if (existing) {
    searchBucketCache.delete(cacheKey)
    searchBucketCache.set(cacheKey, existing)
    return existing
  }
  const promise = fetchJson<AsteroidIndexEntry[]>(
    `${activeReleaseRoot}/search/${encodeURIComponent(normalizedBucket)}.json`,
  ).catch(async () => {
    if (normalizedBucket.startsWith('prefix-')) {
      const legacyInitial = normalizedBucket.slice('prefix-'.length)[0]
      if (legacyInitial) {
        return fetchJson<AsteroidIndexEntry[]>(`${activeReleaseRoot}/search/${encodeURIComponent(legacyInitial)}.json`).catch(() => [])
      }
    }
    const legacyBucket = getLegacyNumericBucketKey(normalizedBucket)
    if (!legacyBucket) return []
    return fetchJson<AsteroidIndexEntry[]>(
      `${activeReleaseRoot}/search/${encodeURIComponent(legacyBucket)}.json`,
    ).catch(() => fetchJson<AsteroidIndexEntry[]>(`${activeReleaseRoot}/search/digit.json`).catch(() => []))
  })
  searchBucketCache.set(cacheKey, promise)
  while (searchBucketCache.size > MAX_SEARCH_BUCKET_CACHE_ENTRIES) {
    const oldestKey = searchBucketCache.keys().next().value
    if (oldestKey === undefined) break
    searchBucketCache.delete(oldestKey)
  }
  return promise
}

function decodeBinaryChunk(metadata: AsteroidIndexEntry[], buffer: ArrayBuffer) {
  const values = new Float64Array(buffer)
  const stride = 8
  if (values.length !== metadata.length * stride) {
    throw new Error(`Binary asteroid shard has ${values.length} values; expected ${metadata.length * stride}`)
  }
  return metadata.map<AsteroidRecord>((entry, index) => {
    const offset = index * stride
    return {
      ...entry,
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

export function loadAsteroidChunk(chunkId: string) {
  const cacheKey = `${activeManifest?.version ?? 'legacy'}:${chunkId}`
  const existing = chunkCache.get(cacheKey)
  if (existing) {
    chunkCache.delete(cacheKey)
    chunkCache.set(cacheKey, existing)
    return existing
  }
  const request = activeManifest?.format === 'binary-v1'
    ? Promise.all([
        fetchJson<AsteroidIndexEntry[]>(`${activeReleaseRoot}/meta/${encodeURIComponent(chunkId)}.json`),
        fetchImmutableArrayBuffer(`${activeReleaseRoot}/binary/${encodeURIComponent(chunkId)}.bin`),
      ]).then(([metadata, buffer]) => decodeBinaryChunk(metadata, buffer))
    : fetchJson<AsteroidRecord[]>(`${activeReleaseRoot}/chunks/${encodeURIComponent(chunkId)}.json`)
  const promise = request.catch((error: unknown) => {
    if (chunkCache.get(cacheKey) === promise) chunkCache.delete(cacheKey)
    throw error
  })
  chunkCache.set(cacheKey, promise)
  while (chunkCache.size > MAX_CHUNK_CACHE_ENTRIES) {
    const oldestKey = chunkCache.keys().next().value
    if (oldestKey === undefined) break
    chunkCache.delete(oldestKey)
  }
  return promise
}

export async function searchAsteroidCatalogPage(params: {
  query: string
  cursor?: number
  pageSize?: number
  maximumChunks?: number
}) {
  const normalized = normalizeSearchText(params.query)
  if (!normalized) return { records: [], total: 0, nextCursor: null as number | null }
  const entries = await loadAsteroidSearchBucket(getSearchBucketKey(params.query))
  const cursor = Math.max(0, params.cursor ?? 0)
  const pageSize = Math.max(1, params.pageSize ?? 1_200)
  const maximumChunks = Math.max(1, params.maximumChunks ?? 30)
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
  const chunks = await Promise.all([...chunkIds].map(loadAsteroidChunk))
  const recordsById = new Map(chunks.flat().map((record) => [record.id, record]))
  const records = selected.map((entry) => recordsById.get(entry.id)).filter((record): record is AsteroidRecord => Boolean(record))
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

export async function loadAsteroidBodiesByIds(ids: BodyId[]) {
  const asteroidIds = [...new Set(ids.filter((id) => id.startsWith('asteroid:')))]
  if (!asteroidIds.length || !activeManifest || (activeManifest.schemaVersion ?? 1) < 2) return []
  const groups = new Map<string, BodyId[]>()
  for (const id of asteroidIds) {
    const bucket = idLookupBucket(id)
    groups.set(bucket, [...(groups.get(bucket) ?? []), id])
  }
  const matchedEntries: AsteroidIndexEntry[] = []
  await Promise.all([...groups].map(async ([bucket, bucketIds]) => {
    const cacheKey = `${activeManifest?.version}:${bucket}`
    let promise = lookupCache.get(cacheKey)
    if (!promise) {
      promise = fetchJson<AsteroidIndexEntry[]>(`${activeReleaseRoot}/lookup/${bucket}.json`).catch(() => [])
      lookupCache.set(cacheKey, promise)
    }
    const entries = await promise
    const wanted = new Set(bucketIds)
    matchedEntries.push(...entries.filter((entry) => wanted.has(entry.id)))
  }))
  const chunks = await Promise.all([...new Set(matchedEntries.map((entry) => entry.chunkId))].map(loadAsteroidChunk))
  const wanted = new Set(asteroidIds)
  return chunks.flat().filter((record) => wanted.has(record.id)).map(asteroidRecordToBody)
}

export function loadAsteroidSample(manifest: AsteroidManifest, size: 'desktop' | 'mobile') {
  const artifact = manifest.precomputedSamples?.[size]
  if (!artifact) return Promise.resolve<AsteroidRecord[]>([])
  const cacheKey = `${manifest.version}:${size}`
  let promise = sampleCache.get(cacheKey)
  if (!promise) {
    const root = manifest.releasePath ?? activeReleaseRoot
    promise = Promise.all([
      fetchJson<AsteroidIndexEntry[]>(`${root}/${artifact.metadataPath}`),
      fetchImmutableArrayBuffer(`${root}/${artifact.binaryPath}`),
    ]).then(([metadata, buffer]) => {
      const values = new Float64Array(buffer)
      if (metadata.length !== artifact.count || values.length !== artifact.count * 8) {
        throw new Error(`Precomputed ${size} sample does not match its manifest count`)
      }
      return metadata.map((entry, index) => {
        const offset = index * 8
        return {
          ...entry,
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
    })
    sampleCache.set(cacheKey, promise)
  }
  return promise
}

export function loadCatalogSummary(manifest: AsteroidManifest) {
  if (!manifest.summaryPath) return Promise.resolve<CatalogSummary | null>(null)
  const cacheKey = `${manifest.version}:${manifest.summaryPath}`
  let promise = summaryCache.get(cacheKey)
  if (!promise) {
    const root = manifest.releasePath ?? activeReleaseRoot
    promise = fetchJson<CatalogSummary>(`${root}/${manifest.summaryPath}`).catch(() => null)
    summaryCache.set(cacheKey, promise)
  }
  return promise
}

export async function loadAsteroidRecordsByLocators(manifest: AsteroidManifest, locators: Uint32Array) {
  if (locators.length % 2 !== 0) throw new Error('Catalog locator array must contain chunk/row pairs')
  const groups = new Map<number, { rowIndex: number; outputIndex: number }[]>()
  for (let index = 0; index < locators.length; index += 2) {
    const chunkIndex = locators[index]
    const rowIndex = locators[index + 1]
    if (chunkIndex >= manifest.chunkCount || rowIndex >= manifest.chunkSize) {
      throw new Error(`Catalog locator is outside the declared dataset: ${chunkIndex}:${rowIndex}`)
    }
    groups.set(chunkIndex, [...(groups.get(chunkIndex) ?? []), { rowIndex, outputIndex: index / 2 }])
  }
  const records = new Array<AsteroidRecord>(locators.length / 2)
  const queue = [...groups.entries()]
  let queueIndex = 0
  const hydrateNext = async () => {
    while (queueIndex < queue.length) {
      const [chunkIndex, requestedRows] = queue[queueIndex]
      queueIndex += 1
      const chunk = await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex))
      for (const { rowIndex, outputIndex } of requestedRows) {
        const record = chunk[rowIndex]
        if (!record) throw new Error(`Catalog locator does not resolve to a record: ${chunkIndex}:${rowIndex}`)
        records[outputIndex] = record
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, hydrateNext))
  return records
}

export async function loadAsteroidSearchLocators(query: string, manifest: AsteroidManifest) {
  if (!manifest.searchIndex?.locators) return null
  const normalized = normalizeSearchText(query)
  if (!normalized) return null
  const entries = await loadAsteroidSearchBucket(getSearchBucketKey(query, manifest.searchIndex.tokenPrefixLength))
  const matched = entries.filter((entry) => entry.searchKey.includes(normalized))
  if (matched.some((entry) => !Number.isSafeInteger(entry.chunkIndex) || !Number.isSafeInteger(entry.rowIndex))) return null
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
    orbitClassCode: record.orbitClassCode,
    orbitClassName: record.orbitClassName || getOrbitClassName(record.orbitClassCode),
    absoluteMagnitude: record.absoluteMagnitude,
    dataEpochLabel: `JD ${record.epochJd}`,
    isCatalogBody: true,
    orbit: {
      model: 'keplerian',
      epochJd: record.epochJd,
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
}) {
  const { manifest, orbitClassCode, pageSize } = params
  let chunkIndex = params.cursor?.chunkIndex ?? 0
  let recordOffset = params.cursor?.recordOffset ?? 0
  const records: AsteroidRecord[] = []
  const startCursor = params.cursor ?? { chunkIndex: 0, recordOffset: 0 }
  while (chunkIndex < manifest.chunkCount && records.length < pageSize) {
    const chunk = await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex))
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
}) {
  const { manifest, orbitClassCode, cursor, pageSize } = params
  const records: AsteroidRecord[] = []
  let chunkIndex = Math.min(cursor.chunkIndex, manifest.chunkCount - 1)
  let recordOffset = cursor.chunkIndex >= manifest.chunkCount ? 0 : cursor.recordOffset
  if (cursor.chunkIndex >= manifest.chunkCount) {
    recordOffset = filterChunkByOrbitClass(await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex)), orbitClassCode).length
  }
  while (chunkIndex >= 0 && records.length < pageSize) {
    const filtered = filterChunkByOrbitClass(await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex)), orbitClassCode)
    const available = filtered.slice(0, recordOffset)
    const sliceStart = Math.max(available.length - (pageSize - records.length), 0)
    records.unshift(...available.slice(sliceStart))
    if (sliceStart > 0) return { records, startCursor: { chunkIndex, recordOffset: sliceStart }, endCursor: cursor }
    chunkIndex -= 1
    if (chunkIndex >= 0) {
      recordOffset = filterChunkByOrbitClass(await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex)), orbitClassCode).length
    }
  }
  return { records, startCursor: { chunkIndex: 0, recordOffset: 0 }, endCursor: cursor }
}
