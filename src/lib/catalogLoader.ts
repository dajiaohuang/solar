import type {
  AsteroidIndexEntry,
  AsteroidManifest,
  AsteroidRecord,
  AsteroidSectionCursor,
  BodyId,
  CelestialBody,
  OrbitClassCode,
} from '../types'

const manifestUrl = '/data/asteroids/manifest.json'
const searchBucketCache = new Map<string, Promise<AsteroidIndexEntry[]>>()
const chunkCache = new Map<string, Promise<AsteroidRecord[]>>()
let manifestPromise: Promise<AsteroidManifest | null> | null = null

function fetchJson<T>(url: string) {
  return fetch(url).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status}`)
    }

    return (await response.json()) as T
  })
}

export function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .trim()
}

export function getSearchBucketKey(searchText: string) {
  const normalized = normalizeSearchText(searchText)
  if (!normalized) {
    return 'misc'
  }

  const firstCharacter = normalized[0]

  if (/[a-z]/.test(firstCharacter)) {
    return firstCharacter
  }

  if (/[0-9]/.test(firstCharacter)) {
    return 'digit'
  }

  return 'misc'
}

export function loadAsteroidManifest() {
  if (!manifestPromise) {
    manifestPromise = fetchJson<AsteroidManifest>(manifestUrl).catch(() => null)
  }

  return manifestPromise
}

export function loadAsteroidSearchBucket(bucketKey: string) {
  const normalizedBucket = bucketKey || 'misc'

  const existing = searchBucketCache.get(normalizedBucket)
  if (existing) {
    return existing
  }

  const promise = fetchJson<AsteroidIndexEntry[]>(
    `/data/asteroids/search/${encodeURIComponent(normalizedBucket)}.json`,
  ).catch(() => [])

  searchBucketCache.set(normalizedBucket, promise)
  return promise
}

export function loadAsteroidChunk(chunkId: string) {
  const existing = chunkCache.get(chunkId)
  if (existing) {
    return existing
  }

  const promise = fetchJson<AsteroidRecord[]>(
    `/data/asteroids/chunks/${encodeURIComponent(chunkId)}.json`,
  )

  chunkCache.set(chunkId, promise)
  return promise
}

function getChunkIdFromIndex(index: number) {
  return `chunk-${String(index).padStart(4, '0')}`
}

function filterChunkByOrbitClass(chunk: AsteroidRecord[], orbitClassCode: string) {
  return orbitClassCode === 'all'
    ? chunk
    : chunk.filter((record) => record.orbitClassCode === orbitClassCode)
}

function getOrbitClassName(code: OrbitClassCode) {
  switch (code) {
    case 'MBA':
      return '主带小行星'
    case 'TNO':
      return '外海王星天体'
    case 'APO':
      return '阿波罗型'
    case 'ATE':
      return '阿登型'
    case 'AMO':
      return '阿莫尔型'
    case 'ATI':
      return '阿提拉型'
    case 'HIL':
      return '希尔达群'
    case 'JTA':
      return '木星特洛伊'
    case 'HUN':
      return '匈牙利群'
    default:
      return '其他小天体'
  }
}

export function asteroidRecordToBody(record: AsteroidRecord): CelestialBody {
  return {
    id: record.id,
    name: record.label,
    shortName: record.shortLabel,
    kind: record.id.startsWith('dwarf:') ? 'dwarfPlanet' : 'asteroid',
    color: record.isNeo ? '#ff9f7f' : record.orbitClassCode === 'TNO' ? '#d8c8ff' : '#c9d7ea',
    size: record.id.startsWith('dwarf:') ? 4.2 : 2.1,
    source: 'mpcorb',
    orbitClassCode: record.orbitClassCode,
    orbitClassName: record.orbitClassName || getOrbitClassName(record.orbitClassCode),
    absoluteMagnitude: record.absoluteMagnitude,
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
    const filteredChunk = filterChunkByOrbitClass(chunk, orbitClassCode)
    const remaining = pageSize - records.length
    const slice = filteredChunk.slice(recordOffset, recordOffset + remaining)
    records.push(...slice)

    if (recordOffset + slice.length < filteredChunk.length) {
      return {
        records,
        startCursor,
        endCursor: {
          chunkIndex,
          recordOffset: recordOffset + slice.length,
        },
      }
    }

    chunkIndex += 1
    recordOffset = 0
  }

  return {
    records,
    startCursor,
    endCursor: {
      chunkIndex,
      recordOffset: 0,
    },
  }
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
    const chunk = await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex))
    recordOffset = filterChunkByOrbitClass(chunk, orbitClassCode).length
  }

  while (chunkIndex >= 0 && records.length < pageSize) {
    const chunk = await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex))
    const filteredChunk = filterChunkByOrbitClass(chunk, orbitClassCode)
    const available = filteredChunk.slice(0, recordOffset)
    const remaining = pageSize - records.length
    const sliceStart = Math.max(available.length - remaining, 0)
    const slice = available.slice(sliceStart)

    records.unshift(...slice)

    if (sliceStart > 0) {
      return {
        records,
        startCursor: {
          chunkIndex,
          recordOffset: sliceStart,
        },
        endCursor: cursor,
      }
    }

    chunkIndex -= 1
    if (chunkIndex >= 0) {
      const previousChunk = await loadAsteroidChunk(getChunkIdFromIndex(chunkIndex))
      recordOffset = filterChunkByOrbitClass(previousChunk, orbitClassCode).length
    }
  }

  return {
    records,
    startCursor: {
      chunkIndex: 0,
      recordOffset: 0,
    },
    endCursor: cursor,
  }
}
