import { catalogAdmission } from '../data/cache/catalogAdmission'
import { readBoundedStream } from '../data/cache/boundedStream'
import { prepareCatalogElementRange, PREPARED_CATALOG_STRIDE, propagatePreparedCatalogPositions, type PreparedCatalogElements } from '../engine/ephemeris/catalogPoints'
import { utcJulianDayToTt } from '../engine/ephemeris/timeScales'
import { catalogMaximumSpeedAUPerTtDay } from '../engine/ephemeris/catalogTemporalBudget'
import { CATALOG_SPATIAL_BLOCK_ROWS } from './catalogSpatialIndex'
import { CATALOG_TRANSFER_WINDOW } from './catalogTransferWindow'
import { CATALOG_SOURCE_RANK_BLOCK_BYTES } from './catalogSourceRow'
import { createCatalogFieldMatcher } from './catalogFilters'
import { normalizeSearchText, validateBinaryElements } from './catalogLoader'
import { bindCatalogChecksums, type CatalogChecksums } from './catalogIntegrity'
import { validateCatalogMetadataRow } from './catalogRecordValidation'
import type { AsteroidIndexEntry, AsteroidManifest, CatalogFilters, CatalogLocator } from '../types'

export const CATALOG_STREAM_CONCURRENCY = 4
export const CATALOG_STREAM_ARTIFACT_TIMEOUT_MS = 30_000
export type CatalogStreamPriority = 'source' | 'neo-first' | 'pha-first'
const MIB = 1024 * 1024
const MAX_STREAM_METADATA_BYTES = 8 * MIB
export type CatalogStreamPlan = { capacity: number; initialCapacity: number; appendCapacity: number; appendReservedBytes: number;
  maximumEpochBlocks: number; budgetBytes: number; reservedBytes: number; metadataMaximumBytes: number; metadataReservedBytes: number }
export type CatalogStreamTile = {
  sourceChunk: number
  /** Positions follow set bits in ascending source-row order. */
  sourceRowMask: Uint8Array
  positions: Float64Array
  appearance: Uint8Array
  /** Examined source rows, including metadata-only query rejections. */
  sourceRows: number
  drawnRows: number
}
export type CatalogSourceSelection = { contentSha256: string; indexSha256: string; shards: { chunk: number; sha256: string; metadataSha256: string; selectedRows: Uint8Array }[] }
export type CatalogScreenedShard = { chunk: number; metadataSha256: string; binarySha256: string | null;
  examinedRows: number; selectedRows: number; outcome: 'metadata-rejected' | 'source-screened' }
export type CatalogReadEvidence = {
  method: 'catalog-application-reads-v1'
  artifacts: Record<'checksums' | 'index' | 'metadata' | 'binary', { attempts: number; completed: number; failed: number; completedBytes: number }>
  indexCacheHits: number; indexReusedBytes: number; binaryCacheHits: number; binaryReusedBytes: number
}
export type CatalogStreamPerformanceReceipt = {
  artifactReadAndHashMs: Record<'checksums' | 'index' | 'metadata' | 'binary', number>
  metadataDecodeAndValidateMs: number
  binaryValidationMs: number
  exactSourceFilteringMs: number
  selectedAttributePackingMs: number
  orbitalElementPreparationMs: number
  keplerPropagationMs: number
  tileDeliveryWaitMs: number
  workerSetupMs: number
  visualCoordinateInstallationMs: number
  transferWindowDrainMs: number
  workerTotalMs: number
}
export type CatalogStreamResult = { sourceRows: number; drawnRows: number; complete: boolean;
  reads: CatalogReadEvidence;
  screening: { admittedShards: number; completedShards: number; metadataOnlyRows: number; completionReason: 'exhausted' | 'capacity'; shards: CatalogScreenedShard[] };
  maximumSpeedAUPerTtDay?: number | null; sourceSelection?: CatalogSourceSelection; performanceMs?: CatalogStreamPerformanceReceipt }
type Checksums = { schemaVersion: number; algorithm: string; files: Record<string, string> }

export type CatalogStreamSourceCache = Readonly<{ kind: 'catalog-stream-source-cache' }>
type SourceCacheEntry = { key: string; indexBuffer: ArrayBuffer; hash: CatalogChecksums;
  binary?: { path: string; hash: string; buffer: ArrayBuffer } }
type SourceCacheState = { maximumIndexBytes: number; maximumBinaryBytes: number; busy: boolean; generation: number;
  entry?: SourceCacheEntry }
const sourceCaches = new WeakMap<CatalogStreamSourceCache, SourceCacheState>()

/** Opaque worker-local cache: callers cannot mutate or transfer verified bytes.
 * One index/checksum map and at most one binary shard, never across releases. */
export function createCatalogStreamSourceCache(maximumIndexBytes: number, maximumBinaryBytes = 0): CatalogStreamSourceCache {
  if (!Number.isSafeInteger(maximumIndexBytes) || maximumIndexBytes < 24 || maximumIndexBytes > 512*MIB) {
    throw new RangeError('Invalid catalog source cache capacity')
  }
  if (!Number.isSafeInteger(maximumBinaryBytes) || maximumBinaryBytes < 0 || maximumBinaryBytes > 65536*64) {
    throw new RangeError('Invalid catalog binary cache capacity')
  }
  const cache = Object.freeze({ kind: 'catalog-stream-source-cache' as const })
  sourceCaches.set(cache,{ maximumIndexBytes, maximumBinaryBytes, busy: false, generation: 0 })
  return cache
}

export function clearCatalogStreamSourceCache(cache: CatalogStreamSourceCache) {
  const state = sourceCaches.get(cache)
  if (state) { state.entry = undefined; state.generation++ }
}

export function planCatalogStream(manifest: AsteroidManifest, requestedRows: number, budgetBytes: number, mode: '2d' | '3d' = '2d', retainEpochs = false, appendRows = 0): CatalogStreamPlan {
  if (mode !== '2d' && mode !== '3d') throw new Error('Invalid catalog streaming dimension')
  if (typeof retainEpochs !== 'boolean') throw new Error('Invalid catalog epoch retention policy')
  if (!Number.isSafeInteger(appendRows) || appendRows < 0 || appendRows > 256 || appendRows > 0 && !retainEpochs) {
    throw new Error('Catalog append reserves require retained epochs and at most 256 rows')
  }
  const { compactIndex: compact, totalCount, chunkSize, chunkCount } = manifest
  if (manifest.format !== 'binary-v1' || !compact || compact.format !== 'catalog-index-v1' || compact.strideBytes !== 24 || compact.count !== totalCount ||
      !Number.isSafeInteger(totalCount) || totalCount < 1 || !Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 65_536 ||
      !Number.isSafeInteger(chunkCount) || chunkCount !== Math.ceil(totalCount / chunkSize) || chunkCount > 65_536 ||
      !Array.isArray(compact.classCodes) || !compact.classCodes.length || compact.classCodes.length > 256 ||
      new Set(compact.classCodes).size !== compact.classCodes.length || compact.classCodes.some(code => typeof code !== 'string' || !code) ||
      !/^[a-zA-Z0-9_-]+\.bin$/.test(compact.path) || !manifest.releasePath) throw new Error('Unsupported catalog streaming manifest')
  if (!Number.isSafeInteger(requestedRows) || requestedRows < 1 || !Number.isSafeInteger(budgetBytes) || budgetBytes < 1 || budgetBytes > 512 * MIB) throw new Error('Invalid catalog streaming budget')
  // Explicit typed-array / GPU admission model, not total browser RSS: index
  // read plus concatenation, optional query locators + bitset, four in-flight
  // shards and compute/transfer scratch, metadata parsing and full-source
  // render/culling headroom. The per-admitted-row term below accounts for the
  // simultaneous resident and replacement selection buffers.
  const spatialIndexBytes = Math.ceil(totalCount/CATALOG_SPATIAL_BLOCK_ROWS)*((mode === '3d' ? 3 : 2)*2*8+5)
  const spatialMembershipBytes = Math.ceil(totalCount / 32) * 4
  // Source-row masks may coexist across the worker/main-thread handoff. Each
  // shard rounds its mask independently. Headroom includes per-shard screening
  // receipts alongside selected-row hashes across the worker handoff.
  // Reusable upload-rank prefixes: one uint32 per 256 mask bytes, plus map
  // entry headroom per shard. Masks are borrowed, never copied by the lookup.
  const sourceRankBytes = chunkCount * (4 * Math.ceil(Math.ceil(chunkSize/8)/CATALOG_SOURCE_RANK_BLOCK_BYTES) + 64)
  // One extra byte per source shard marks exact candidate-shard membership.
  const sourceSelectionBytes = 3 * (Math.ceil(totalCount/8)+chunkCount) + chunkCount*2048 + sourceRankBytes + chunkCount
  // Four bounded reads/hash copies (128 B/row each), one raw/selected/prepared/
  // computed shard (rounded up to 240 B/row), and four transferred xyz+appearance
  // tiles (26 B/row), plus one returned Float64 xyz buffer (24 B/row).
  // Keep the older, larger reservation as additional headroom.
  const pipelineBytes = chunkSize * Math.max(CATALOG_STREAM_CONCURRENCY*256,
    CATALOG_STREAM_CONCURRENCY*128 + 240 + CATALOG_TRANSFER_WINDOW*26 + 24)
  // One source-metadata shard at a time: bounded bytes, UTF-8 decoding/JSON
  // scratch headroom, and compact extracted columns. Object overhead is an
  // estimate, not a bound on engine-managed heap or total browser RSS.
  // Reserve at most one quarter of the chosen budget for metadata parsing,
  // capped at the 8 MiB source-file policy. The reader enforces this same cap;
  // a larger shard fails explicitly instead of borrowing unreserved memory.
  const metadataMaximumBytes = Math.max(1, Math.min(MAX_STREAM_METADATA_BYTES, Math.floor(budgetBytes/32)))
  const metadataBytes = metadataMaximumBytes * 8 + chunkSize * 11
  // Append is serialized after initial loading and reuses the pipeline reserve.
  // Reserve worker/main copies of base rank/source maps, three copies of masks
  // (one new body per shard is the worst case), bounded staged/committed maps and
  // extra epoch blocks/receipts. Map/object overhead is estimated headroom, not
  // a total JS heap bound. GPU/coefficients remain in the per-point allocation.
  // A single retained binary shard is charged separately from active reads.
  const appendReservedBytes = appendRows ? chunkSize*64 + 2*sourceRankBytes + chunkCount*256 +
    appendRows*(3*Math.ceil(chunkSize/8)+4096+128) : 0
  const maximumEpochBlocks = chunkCount+appendRows
  const fixed = totalCount * (48 + 9) + pipelineBytes + metadataBytes + 8 * MIB + spatialIndexBytes + spatialMembershipBytes + sourceSelectionBytes + appendReservedBytes + (retainEpochs ? 2 * MIB + chunkCount * 128 : 0)
  // Worst-case admitted-row charge for spatial display. In 2D, the 72 B base
  // is 48 B of CPU/GPU point attributes, 8 B of worker culling positions, and
  // 16 B for worker winners/output indices plus the previous CPU selection and
  // GPU index-buffer high-water mark that can coexist during replacement. The
  // extra byte below is winnerInside; retain-all views skip winner arrays.
  // 3D adds one Float32 coordinate in both CPU/GPU attributes and worker culling.
  // Ten Float64 prepared coefficients per retained row are additional resident
  // storage, never hidden inside the static snapshot budget. The packed source
  // membership bitmap and spatial block bounds are separately reserved above.
  const perPoint = (mode === '3d' ? 84 : 72) + 1 + (retainEpochs ? 80 : 0)
  const capacity = Math.min(totalCount, requestedRows, Math.max(0, Math.floor((budgetBytes - fixed) / perPoint)))
  // Requested rows remain the total ceiling. Keep at least one initial row;
  // append slots are unavailable to the initial loader, never extra capacity.
  const appendCapacity = Math.min(appendRows,Math.max(0,capacity-1))
  return { capacity, initialCapacity: capacity-appendCapacity, appendCapacity, appendReservedBytes, maximumEpochBlocks,
    budgetBytes, reservedBytes: fixed + capacity * perPoint, metadataMaximumBytes, metadataReservedBytes: metadataBytes }
}

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** HTTP caching remains available; this path avoids unbounded asynchronous
 * IndexedDB writes. */
async function fetchArtifact(url: string, maximumBytes: number, expectedHash: string | undefined, signal: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  // Include admission wait and body consumption, not just response headers.
  const deadline = performance.now() + CATALOG_STREAM_ARTIFACT_TIMEOUT_MS
  const timeout = () => new DOMException('Catalog artifact exceeded its 30-second deadline', 'TimeoutError')
  const check = () => {
    if (performance.now() >= deadline && !controller.signal.aborted) controller.abort(timeout())
    controller.signal.throwIfAborted()
  }
  const timer = setTimeout(() => controller.abort(timeout()), CATALOG_STREAM_ARTIFACT_TIMEOUT_MS)
  let release: (() => void) | undefined
  try {
    release = await catalogAdmission.acquire(controller.signal)
    check()
    const response = await fetch(url, { signal: controller.signal })
    if (controller.signal.aborted || performance.now() >= deadline || !response.ok) {
      await response.body?.cancel().catch(() => undefined)
      check()
      throw new Error(`Failed to load catalog artifact: ${response.status}`)
    }
    if (Number(response.headers.get('content-length')) > maximumBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Catalog artifact exceeds its declared capacity')
    }
    const buffer = response.body ? await readBoundedStream(response.body, maximumBytes, controller.signal) : new ArrayBuffer(0)
    check()
    if (expectedHash !== undefined) {
      const actualHash = await sha256(buffer)
      check()
      if (actualHash !== expectedHash) throw new Error('Catalog artifact SHA-256 mismatch')
    }
    return buffer
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    release?.()
  }
}

async function loadStreamMetadata(root: string, chunk: number, count: number, classes: string[], query: string, expectedHash: string, maximumBytes: number, signal: AbortSignal, read = fetchArtifact, performanceReceipt?: CatalogStreamPerformanceReceipt, yieldControl: () => Promise<void> = () => new Promise<void>(resolve => setTimeout(resolve, 0))) {
  signal.throwIfAborted()
  const controller = new AbortController(), abort = () => controller.abort(signal.reason)
  const deadline = performance.now() + CATALOG_STREAM_ARTIFACT_TIMEOUT_MS
  const timeout = () => new DOMException('Catalog metadata read and decode exceeded 30 seconds', 'TimeoutError')
  const timer = setTimeout(() => controller.abort(timeout()), CATALOG_STREAM_ARTIFACT_TIMEOUT_MS)
  signal.addEventListener('abort', abort, { once: true })
  const check = () => {
    if (performance.now() >= deadline && !controller.signal.aborted) controller.abort(timeout())
    controller.signal.throwIfAborted()
  }
  try {
    const id = `chunk-${String(chunk).padStart(4, '0')}`
    const bytes = await read(`${root}/meta/${id}.json`, maximumBytes, expectedHash, controller.signal)
    check()
    const parseStarted = performanceReceipt ? performance.now() : 0
    const records = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as AsteroidIndexEntry[]
    if (performanceReceipt) performanceReceipt.metadataDecodeAndValidateMs += performance.now() - parseStarted
    check()
    if (!Array.isArray(records) || records.length !== count) throw new Error('Catalog stream metadata count differs from source shard')
    const magnitudes = new Float64Array(count), classIndices = new Uint8Array(count), flags = new Uint8Array(count), queryMatches = new Uint8Array(count)
    const ids = new Set<string>(), classMap = new Map(classes.map((code, index) => [code, index] as const))
    let validationStarted = performanceReceipt ? performance.now() : 0
    for (let row = 0; row < count; row++) {
      if (row % 1024 === 0) {
        if (row && performanceReceipt) performanceReceipt.metadataDecodeAndValidateMs += performance.now() - validationStarted
        await yieldControl()
        check()
        if (performanceReceipt) validationStarted = performance.now()
      }
      const entry = records[row]
      validateCatalogMetadataRow(entry, row, ids, id, chunk)
      const classIndex = classMap.get(entry.orbitClassCode)
      if (classIndex === undefined) throw new Error('Catalog stream metadata class is absent from index')
      magnitudes[row] = entry.absoluteMagnitude ?? NaN
      classIndices[row] = classIndex
      flags[row] = (entry.isNeo ? 1 : 0) | (entry.isPha ? 2 : 0) | (entry.absoluteMagnitude !== undefined ? 4 : 0)
      queryMatches[row] = !query || entry.searchKey.includes(query) ? 1 : 0
    }
    if (performanceReceipt) performanceReceipt.metadataDecodeAndValidateMs += performance.now() - validationStarted
    check()
    return { magnitudes, classIndices, flags, queryMatches }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    controller.abort()
  }
}

type StreamOptions = {
  sourceCache?: CatalogStreamSourceCache
  // Optional ownership-return pool. Must return a whole, exact-sized buffer;
  // the producer overwrites every coordinate before publishing it again.
  acquirePositions?: (elements: number) => Float64Array
  priorityLocators?: readonly CatalogLocator[]
  yieldControl?: () => Promise<void>
  retainEpochs?: boolean
  appendRows?: number
  onPrepared?: (prepared: PreparedCatalogElements, startRow: number, maximumSpeedAUPerTtDay: number | null) => void
  priority?: CatalogStreamPriority
  mode?: '2d' | '3d'
  manifest: AsteroidManifest
  filters: CatalogFilters
  julianDay: number
  requestedRows: number
  budgetBytes: number
  candidateLocators?: Uint32Array
  capturePerformanceReceipt?: boolean
  signal: AbortSignal
  // Awaiting this callback is the backpressure boundary: the worker's bounded
  // transfer window admits further work only while upload credits remain.
  onTile: (tile: CatalogStreamTile) => Promise<void>
}

export async function streamCatalogPoints(options: StreamOptions): Promise<CatalogStreamResult> {
  options.signal.throwIfAborted()
  // Retain callbacks/signals by identity, but own data contracts before any
  // fetch, admission wait or upload callback can yield back to the caller.
  // Candidate locators are consumed into the private bitset below before the
  // first await; copying that potentially catalog-sized array is unnecessary.
  options = { ...options, manifest: structuredClone(options.manifest), filters: structuredClone(options.filters), priorityLocators: structuredClone(options.priorityLocators) }
  const { manifest, filters, signal, onTile } = options
  const yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)))
  const cooperate = async () => { signal.throwIfAborted(); await yieldControl(); signal.throwIfAborted() }
  signal.throwIfAborted()
  const priority = options.priority ?? 'source'
  if (!['source', 'neo-first', 'pha-first'].includes(priority)) throw new Error('Invalid catalog source priority')
  const priorityFlag = priority === 'neo-first' ? 1 : priority === 'pha-first' ? 2 : 0
  if (!Number.isFinite(options.julianDay) || options.julianDay < 2441317.5) throw new Error('Catalog streaming requires a UTC epoch from 1972 onwards')
  const mode = options.mode ?? '2d', stride = mode === '3d' ? 3 : 2
  const plan = planCatalogStream(manifest, options.requestedRows, options.budgetBytes, mode, options.retainEpochs, options.appendRows)
  if (Boolean(options.onPrepared) !== Boolean(options.retainEpochs)) throw new Error('Retained catalog epochs require both budget admission and a source receiver')
  if (!plan.initialCapacity) throw new Error('Catalog index, metadata and pipeline reserves exceed the available streaming budget')
  const priorityLocators = options.priorityLocators ?? []
  if (priorityLocators.length > 256 || priorityLocators.some(locator => !Number.isSafeInteger(locator.chunkIndex) || !Number.isSafeInteger(locator.rowIndex) ||
      locator.chunkIndex < 0 || locator.chunkIndex >= manifest.chunkCount || locator.rowIndex < 0 || locator.rowIndex >= manifest.chunkSize ||
      locator.chunkIndex*manifest.chunkSize+locator.rowIndex >= manifest.totalCount)) throw new Error('Invalid bounded catalog priority locators')
  const query = normalizeSearchText(filters.query)
  const ranges = [filters.semiMajorAxis, filters.eccentricity, filters.inclination, filters.absoluteMagnitude, filters.perihelion]
  if (ranges.some(range => range.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1])) throw new Error('Invalid catalog filter interval')
  const compact = manifest.compactIndex!, root = manifest.releasePath!.replace(/\/$/, '')
  let candidates: Uint8Array | undefined
  let candidateChunks: Uint8Array | undefined
  if (options.candidateLocators) {
    const locators = options.candidateLocators
    if (locators.length % 2 || locators.length > manifest.totalCount * 2) throw new Error('Invalid source locator capacity')
    candidates = new Uint8Array(Math.ceil(manifest.totalCount / 8))
    candidateChunks = new Uint8Array(manifest.chunkCount)
    for (let i = 0; i < locators.length; i += 2) {
      const chunk = locators[i], row = locators[i + 1], offset = chunk * manifest.chunkSize + row
      if (chunk >= manifest.chunkCount || row >= manifest.chunkSize || offset >= manifest.totalCount) throw new Error('Invalid source locator')
      candidates[offset >> 3] |= 1 << (offset & 7)
      candidateChunks[chunk] = 1
    }
  }
  const hasCandidate = (row: number) => !candidates || Boolean(candidates[row >> 3] & (1 << (row & 7)))
  const controller = new AbortController(), abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  const pending = new Map<number, Promise<{ buffer: ArrayBuffer } | { error: unknown }>>()
  const sourceCache = options.sourceCache ? sourceCaches.get(options.sourceCache) : undefined
  if (options.sourceCache && (!sourceCache || sourceCache.busy || manifest.totalCount*24 > sourceCache.maximumIndexBytes)) {
    signal.removeEventListener('abort',abort)
    throw new Error('Catalog source cache is unavailable, busy or too small')
  }
  if (sourceCache) sourceCache.busy = true
  const counter = () => ({ attempts: 0, completed: 0, failed: 0, completedBytes: 0 })
  const reads: CatalogReadEvidence = { method: 'catalog-application-reads-v1',
    artifacts: { checksums: counter(), index: counter(), metadata: counter(), binary: counter() },
    indexCacheHits: 0, indexReusedBytes: 0, binaryCacheHits: 0, binaryReusedBytes: 0 }
  const performanceMs: CatalogStreamPerformanceReceipt | undefined = options.capturePerformanceReceipt ? {
    artifactReadAndHashMs: { checksums: 0, index: 0, metadata: 0, binary: 0 },
    metadataDecodeAndValidateMs: 0, binaryValidationMs: 0, exactSourceFilteringMs: 0, selectedAttributePackingMs: 0,
    orbitalElementPreparationMs: 0, keplerPropagationMs: 0, tileDeliveryWaitMs: 0,
    workerSetupMs: 0, visualCoordinateInstallationMs: 0, transferWindowDrainMs: 0, workerTotalMs: 0,
  } : undefined
  const read = async (kind: keyof CatalogReadEvidence['artifacts'], ...args: Parameters<typeof fetchArtifact>) => {
    const counters = reads.artifacts[kind]
    counters.attempts++
    const started = performanceMs ? performance.now() : 0
    try {
      const bytes = await fetchArtifact(...args)
      counters.completed++; counters.completedBytes += bytes.byteLength
      return bytes
    } catch (error) { counters.failed++; throw error }
    finally { if (performanceMs) performanceMs.artifactReadAndHashMs[kind] += performance.now() - started }
  }
  const readMetadata: typeof fetchArtifact = (...args) => read('metadata',...args)
  try {
    signal.throwIfAborted()
    const sourceKey = JSON.stringify(manifest)
    if (sourceCache?.entry && sourceCache.entry.key !== sourceKey) sourceCache.entry = undefined
    const cacheGeneration = sourceCache?.generation
    let entry: SourceCacheEntry | undefined = sourceCache?.entry
    if (entry) { reads.indexCacheHits++; reads.indexReusedBytes += entry.indexBuffer.byteLength }
    if (!entry) {
      const checksums = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read('checksums',`${root}/checksums.json`, 2 * MIB, undefined, controller.signal))) as Checksums
      const hash = await bindCatalogChecksums(checksums, manifest, controller.signal)
      const indexBuffer = await read('index',`${root}/${compact.path}`, manifest.totalCount * 24, hash(compact.path), controller.signal)
      if (indexBuffer.byteLength !== manifest.totalCount * 24) throw new Error('Incomplete compact catalog index')
      signal.throwIfAborted()
      entry = { key: sourceKey, indexBuffer, hash }
      // Existing stream reserves cover the index read/concatenation and 8 MiB
      // checksum headroom. Do not retain a larger estimated map between calls.
      if (sourceCache && sourceCache.generation === cacheGeneration && hash.retainedWeight+sourceKey.length*2 <= 8*MIB) sourceCache.entry = entry
    }
    const { hash, indexBuffer } = entry
    const verifiedEntry = entry
    const loadBinary = async (path: string, count: number) => {
      controller.signal.throwIfAborted()
      const expectedHash = hash(path), expectedBytes = count*64
      const cached = verifiedEntry.binary
      if (sourceCache && sourceCache.entry === verifiedEntry && sourceCache.generation === cacheGeneration &&
          cached?.path === path && cached.hash === expectedHash && cached.buffer.byteLength === expectedBytes) {
        reads.binaryCacheHits++; reads.binaryReusedBytes += cached.buffer.byteLength
        return cached.buffer
      }
      const buffer = await read('binary',`${root}/${path}`,expectedBytes,expectedHash,controller.signal)
      if (buffer.byteLength !== expectedBytes) throw new Error('Incomplete catalog element shard')
      if (sourceCache && sourceCache.generation === cacheGeneration && sourceCache.entry === verifiedEntry &&
          buffer.byteLength <= sourceCache.maximumBinaryBytes) {
        verifiedEntry.binary = { path, hash: expectedHash, buffer }
      }
      return buffer
    }
    const index = new DataView(indexBuffer)
    // Only exact index fields may exclude a shard. The quantized e/i/H columns
    // cannot decide source-precision boundaries (including perihelion).
    const matchesIndex = createCatalogFieldMatcher({ ...filters, query: '',
      eccentricity: [0, 1], inclination: [0, 180], perihelion: [0, Number.MAX_VALUE],
      absoluteMagnitude: [-Infinity, Infinity], magnitudeStatus: 'all' })
    let chunks: number[] = []
    const deferredChunks: number[] = []
    let inspected = 0
    for (let chunk = 0; chunk < manifest.chunkCount; chunk++) {
      signal.throwIfAborted()
      // Candidate membership is exact. Avoid visiting every index row in
      // unrelated shards when appending a bounded selected-object list.
      if (candidateChunks && !candidateChunks[chunk]) {
        if (chunk > 0 && chunk % 1024 === 0) await cooperate()
        continue
      }
      let admitted = false, preferred = false
      const end = Math.min(manifest.totalCount, (chunk + 1) * manifest.chunkSize)
      for (let row = chunk * manifest.chunkSize; row < end; row++) {
        if (++inspected % 20_000 === 0) {
          await cooperate()
        }
        if (!hasCandidate(row)) continue
        const offset = row * 24, a = index.getFloat64(offset, true)
        const classIndex = index.getUint8(offset + 18), flags = index.getUint8(offset + 19), magnitude = index.getInt16(offset + 16, true)
        if (index.getUint16(offset + 20, true) !== chunk || index.getUint16(offset + 22, true) !== row - chunk * manifest.chunkSize) throw new Error('Catalog index locator mismatch')
        if (!Number.isFinite(a) || a <= 0 || classIndex >= compact.classCodes.length || flags > 7 || Boolean(flags & 4) !== (magnitude !== 0x7fff)) throw new Error('Invalid catalog index metadata')
        if (matchesIndex('', compact.classCodes[classIndex], magnitude === 0x7fff ? undefined : magnitude / 100, a, 0, 0)) {
          admitted = true
          preferred = priorityFlag === 0 || Boolean(flags & priorityFlag)
          if (preferred) break
        }
      }
      // Stable shard priority only. Exact source filters still run below; a
      // preferred shard can contain ordinary rows or no final filter matches.
      if (admitted) (preferred ? chunks : deferredChunks).push(chunk)
    }
    for (const chunk of deferredChunks) chunks.push(chunk)
    if (priorityLocators.length) {
      const admitted = new Set(chunks)
      const promoted = new Set(priorityLocators.map(locator => locator.chunkIndex).filter(chunk => admitted.has(chunk)))
      chunks = [...promoted, ...chunks.filter(chunk => !promoted.has(chunk))]
    }
    const matches = createCatalogFieldMatcher({ ...filters, query: '' })
    const matchesSourceRow = (chunk: number, row: number, elements: Float64Array, metadata: Awaited<ReturnType<typeof loadStreamMetadata>>) => {
      const sourceRow = chunk * manifest.chunkSize + row, offset = sourceRow * 24, orbit = row * 8
      if (index.getUint16(offset + 20, true) !== chunk || index.getUint16(offset + 22, true) !== row) throw new Error('Catalog index locator mismatch')
      const classIndex = index.getUint8(offset + 18), flags = index.getUint8(offset + 19), magnitude = index.getInt16(offset + 16, true)
      if (classIndex >= compact.classCodes.length || flags > 7 || Boolean(flags & 4) !== (magnitude !== 0x7fff)) throw new Error('Invalid catalog appearance metadata')
      const sourceMagnitude = Number.isNaN(metadata.magnitudes[row]) ? undefined : metadata.magnitudes[row]
      if (classIndex !== metadata.classIndices[row] || flags !== metadata.flags[row] ||
          magnitude !== (sourceMagnitude === undefined ? 0x7fff : Math.round(sourceMagnitude*100))) throw new Error('Catalog index metadata differs from source shard')
      // Quantized index fields establish identity, never exact filter boundaries.
      if (index.getFloat64(offset, true) !== elements[orbit + 1] || index.getUint32(offset + 8, true) !== Math.round(elements[orbit + 2] * 1e9) || index.getUint32(offset + 12, true) !== Math.round(elements[orbit + 3] * 1e6)) throw new Error('Catalog index orbital fields mismatch')
      return hasCandidate(sourceRow) && Boolean(metadata.queryMatches[row]) &&
        matches('', compact.classCodes[classIndex], sourceMagnitude, elements[orbit + 1], elements[orbit + 2], elements[orbit + 3])
    }
    // Resolve eligibility before ordinary rows can exhaust the global budget.
    // Only one priority shard is held, before binary prefetch starts. Retain at
    // most 256 row identities across shards; the sole-first-shard handoff below
    // may also keep that shard as the already-budgeted next compute input.
    const eligiblePriorityRows = new Set<number>()
    const checkedPriorityChunks = new Set<number>()
    const priorityByChunk = new Map<number, Set<number>>()
    // A single priority shard is also the first compute input. Hand its
    // verified data into the existing queue instead of fetching it twice.
    // Never hold it while preflighting a second shard: metadata admits one.
    let firstPriorityMetadata: Awaited<ReturnType<typeof loadStreamMetadata>> | undefined
    let firstPriorityBuffer: ArrayBuffer | undefined
    const admittedChunks = new Set(chunks)
    for (const locator of priorityLocators) {
      if (!admittedChunks.has(locator.chunkIndex)) continue
      let rows = priorityByChunk.get(locator.chunkIndex)
      if (!rows) { rows = new Set(); priorityByChunk.set(locator.chunkIndex, rows) }
      rows.add(locator.rowIndex)
    }
    for (const [chunk, rows] of priorityByChunk) {
      signal.throwIfAborted()
      const count = Math.min(manifest.chunkSize, manifest.totalCount - chunk * manifest.chunkSize)
      const metadataPath = `meta/chunk-${String(chunk).padStart(4, '0')}.json`
      const metadata = await loadStreamMetadata(root, chunk, count, compact.classCodes, query, hash(metadataPath), plan.metadataMaximumBytes, controller.signal, readMetadata, performanceMs, yieldControl)
      const reuseFirst = priorityByChunk.size === 1 && chunk === chunks[0]
      if (reuseFirst) firstPriorityMetadata = metadata
      if ([...rows].some(row => metadata.queryMatches[row] && hasCandidate(chunk*manifest.chunkSize+row))) {
        const binaryPath = `binary/chunk-${String(chunk).padStart(4, '0')}.bin`
        const buffer = await loadBinary(binaryPath,count)
        if (buffer.byteLength !== count*64) throw new Error('Incomplete catalog priority element shard')
        if (reuseFirst) firstPriorityBuffer = buffer
        const elements = new Float64Array(buffer)
        for (const row of rows) {
          validateBinaryElements(buffer, row, row+1)
          if (matchesSourceRow(chunk, row, elements, metadata)) eligiblePriorityRows.add(chunk*manifest.chunkSize+row)
        }
      }
      checkedPriorityChunks.add(chunk)
      if (eligiblePriorityRows.size >= plan.initialCapacity) {
        // Grouped reads may resolve a later locator before an earlier locator
        // in another shard. Stop only when the known list prefix fills capacity.
        const resolvedPrefix = new Set<number>()
        for (const locator of priorityLocators) {
          if (!admittedChunks.has(locator.chunkIndex)) continue
          if (!checkedPriorityChunks.has(locator.chunkIndex)) break
          const row = locator.chunkIndex*manifest.chunkSize+locator.rowIndex
          if (eligiblePriorityRows.has(row)) resolvedPrefix.add(row)
          if (resolvedPrefix.size >= plan.initialCapacity) break
        }
        if (resolvedPrefix.size >= plan.initialCapacity) break
      }
      await cooperate()
    }
    const reservedRows = new Set<number>()
    for (const locator of priorityLocators) {
      const row = locator.chunkIndex*manifest.chunkSize+locator.rowIndex
      if (reservedRows.size < plan.initialCapacity && eligiblePriorityRows.has(row)) reservedRows.add(row)
    }
    const enqueue = (sequence: number) => {
      if (sequence >= chunks.length) return
      if (pending.has(sequence)) return
      signal.throwIfAborted()
      if (pending.size >= CATALOG_STREAM_CONCURRENCY) throw new Error('Catalog prefetch queue exceeded its admitted capacity')
      const chunk = chunks[sequence], path = `binary/chunk-${String(chunk).padStart(4, '0')}.bin`
      const count = Math.min(manifest.chunkSize, manifest.totalCount - chunk * manifest.chunkSize)
      if (sequence === 0 && firstPriorityBuffer) {
        pending.set(sequence, Promise.resolve({ buffer: firstPriorityBuffer }))
        firstPriorityBuffer = undefined
      } else {
        pending.set(sequence, loadBinary(path,count).then(buffer => ({ buffer }), error => ({ error })))
      }
    }
    // Name searches admit binary reads only after source metadata matches.
    // Ordinary catalog loads retain the four-shard binary prefetch window.
    if (!query) for (let i = 0; i < Math.min(chunks.length, CATALOG_STREAM_CONCURRENCY); i++) enqueue(i)
    const epochTt = utcJulianDayToTt(options.julianDay)
    let sourceRows = 0, drawnRows = 0, capacityOmitted = false
    let completedShards = 0, metadataOnlyRows = 0
    const screenedShards: CatalogScreenedShard[] = []
    let maximumSpeed: number | null = 0
    const sourceSelection: CatalogSourceSelection = { contentSha256: manifest.contentSha256!, indexSha256: hash(compact.path), shards: [] }
    const result = (complete: boolean): CatalogStreamResult => ({ sourceRows, drawnRows, complete, reads,
      screening: { admittedShards: chunks.length, completedShards, metadataOnlyRows, completionReason: complete ? 'exhausted' : 'capacity', shards: screenedShards },
      maximumSpeedAUPerTtDay: options.retainEpochs && drawnRows > 0 ? maximumSpeed : null, sourceSelection, performanceMs })
    for (let sequence = 0; sequence < chunks.length; sequence++) {
      const chunk = chunks[sequence]
      const count = Math.min(manifest.chunkSize, manifest.totalCount - chunk * manifest.chunkSize)
      const metadataHash = hash(`meta/chunk-${String(chunk).padStart(4, '0')}.json`)
      const metadata = sequence === 0 && firstPriorityMetadata ? firstPriorityMetadata
        : await loadStreamMetadata(root, chunk, count, compact.classCodes, query, metadataHash, plan.metadataMaximumBytes, controller.signal, readMetadata, performanceMs, yieldControl)
      firstPriorityMetadata = undefined
      signal.throwIfAborted()
      if (query) {
        const hasQueryCandidate = metadata.queryMatches.some((matched, row) => matched !== 0 && hasCandidate(chunk*manifest.chunkSize+row))
        if (!hasQueryCandidate) {
          // These rows were rejected by checked source metadata; their orbital
          // bytes were not fetched or validated. Keep progress backpressured.
          sourceRows += count
          metadataOnlyRows += count; completedShards++
          screenedShards.push({ chunk, metadataSha256: metadataHash, binarySha256: null,
            examinedRows: count, selectedRows: 0, outcome: 'metadata-rejected' })
          await onTile({ sourceChunk: chunk, sourceRowMask: new Uint8Array(Math.ceil(count/8)), positions: new Float64Array(0), appearance: new Uint8Array(0), sourceRows, drawnRows })
          await cooperate()
          continue
        }
        enqueue(sequence)
      }
      const loaded = await pending.get(sequence)!
      pending.delete(sequence)
      signal.throwIfAborted()
      if ('error' in loaded) throw loaded.error
      const elements = new Float64Array(loaded.buffer)
      // Once a shard becomes the single compute input, replenish the separate
      // prefetch queue while its cooperative work yields. Near the row ceiling,
      // defer replenishment until exact filtering establishes more is needed.
      const refill = sequence + CATALOG_STREAM_CONCURRENCY
      if (!query && plan.initialCapacity-drawnRows > count) enqueue(refill)
      if (elements.length !== count * 8) throw new Error('Incomplete catalog element shard')
      for (let start = 0; start < count; start += 4096) {
        const validationStarted = performanceMs ? performance.now() : 0
        validateBinaryElements(loaded.buffer, start, Math.min(count, start+4096))
        if (performanceMs) performanceMs.binaryValidationMs += performance.now() - validationStarted
        await cooperate()
      }
      const selectedRows = new Uint8Array(Math.ceil(count/8))
      // Reserve membership across shards, keeping output in source-row order.
      const remaining = plan.initialCapacity - drawnRows
      let used = 0, examinedRows = 0
      let filteringStarted = performanceMs ? performance.now() : 0
      for (let row = 0; row < count; row++) {
        if (row > 0 && row % 2048 === 0) {
          if (performanceMs) performanceMs.exactSourceFilteringMs += performance.now() - filteringStarted
          await cooperate()
          if (performanceMs) filteringStarted = performance.now()
        }
        const sourceRow = chunk * manifest.chunkSize + row
        sourceRows++
        examinedRows++
        if (!matchesSourceRow(chunk, row, elements, metadata)) continue
        if (drawnRows + used >= plan.initialCapacity) { capacityOmitted = true; break }
        if (!reservedRows.has(sourceRow) && used + reservedRows.size >= remaining) { capacityOmitted = true; continue }
        reservedRows.delete(sourceRow)
        selectedRows[row >>> 3] |= 1 << (row & 7)
        used++
      }
      if (performanceMs) performanceMs.exactSourceFilteringMs += performance.now() - filteringStarted
      if (examinedRows === count) completedShards++
      // Allocate only admitted rows. Sparse filters and nearly-full budgets
      // need not retain a full-shard orbital/appearance scratch allocation.
      let packingStarted = performanceMs ? performance.now() : 0
      const selectedElements = new Float64Array(used * 8), appearance = new Uint8Array(used * 2)
      let copied = 0
      for (let byte = 0; byte < selectedRows.length && copied < used; byte++) {
        if (byte > 0 && byte % 256 === 0) {
          if (performanceMs) performanceMs.selectedAttributePackingMs += performance.now() - packingStarted
          await cooperate()
          if (performanceMs) packingStarted = performance.now()
        }
        let bits = selectedRows[byte]
        while (bits) {
          const bit = 31 - Math.clz32(bits & -bits), row = byte * 8 + bit
          const orbit = row * 8, target = copied * 8
          // Preserve Float64 values without allocating one view per body.
          for (let column = 0; column < 8; column++) selectedElements[target + column] = elements[orbit + column]
          const offset = (chunk * manifest.chunkSize + row) * 24
          appearance[copied * 2] = index.getUint8(offset + 18)
          appearance[copied * 2 + 1] = index.getUint8(offset + 19)
          copied++
          bits &= bits - 1
        }
      }
      if (copied !== used) throw new Error('Catalog admitted row mask count mismatch')
      if (performanceMs) performanceMs.selectedAttributePackingMs += performance.now() - packingStarted
      const prepared: PreparedCatalogElements = { count: used, data: new Float64Array(used*PREPARED_CATALOG_STRIDE) }
      const positions = options.acquirePositions?.(used*stride) ?? new Float64Array(used*stride)
      if (!(positions instanceof Float64Array) || positions.length !== used*stride || positions.byteOffset !== 0 ||
          !(positions.buffer instanceof ArrayBuffer) || positions.buffer.byteLength !== used*stride*8) throw new Error('Invalid owned catalog position buffer')
      let speed: number | null = options.retainEpochs && used ? 0 : null
      for (let start = 0; start < used; start += 256) {
        const end = Math.min(used, start+256)
        const preparationStarted = performanceMs ? performance.now() : 0
        prepareCatalogElementRange(selectedElements, prepared, start, end)
        if (speed !== null) {
          const sliceSpeed = catalogMaximumSpeedAUPerTtDay(selectedElements.subarray(start*8, end*8))
          speed = sliceSpeed === null ? null : Math.max(speed, sliceSpeed)
        }
        if (performanceMs) performanceMs.orbitalElementPreparationMs += performance.now() - preparationStarted
        const propagationStarted = performanceMs ? performance.now() : 0
        propagatePreparedCatalogPositions(prepared, epochTt, mode, positions, start, end)
        if (performanceMs) performanceMs.keplerPropagationMs += performance.now() - propagationStarted
        await cooperate()
      }
      signal.throwIfAborted()
      if (options.retainEpochs && used && maximumSpeed !== null) maximumSpeed = speed === null ? null : Math.max(maximumSpeed, speed)
      options.onPrepared?.(prepared, drawnRows, speed)
      screenedShards.push({ chunk, metadataSha256: metadataHash, binarySha256: hash(`binary/chunk-${String(chunk).padStart(4, '0')}.bin`),
        examinedRows, selectedRows: used, outcome: 'source-screened' })
      if (used) sourceSelection.shards.push({ chunk,
        sha256: hash(`binary/chunk-${String(chunk).padStart(4, '0')}.bin`), metadataSha256: metadataHash, selectedRows })
      drawnRows += used
      const deliveryStarted = performanceMs ? performance.now() : 0
      await onTile({ sourceChunk: chunk, sourceRowMask: selectedRows, positions, appearance, sourceRows, drawnRows })
      if (performanceMs) performanceMs.tileDeliveryWaitMs += performance.now() - deliveryStarted
      signal.throwIfAborted()
      if (drawnRows >= plan.initialCapacity) {
        if (reservedRows.size) throw new Error('Catalog capacity exhausted before priority admission')
        return result(!capacityOmitted && sequence === chunks.length - 1)
      }
      if (!query) enqueue(refill)
    }
    if (reservedRows.size || capacityOmitted) throw new Error('Catalog priority reservation did not complete')
    return result(true)
  } catch (error) {
    if (sourceCache) { sourceCache.entry = undefined; sourceCache.generation++ }
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
    controller.abort()
    try { await Promise.all(pending.values()) }
    finally {
      // The result references this object, but resolves only after finally.
      // Include all admitted prefetch outcomes, including aborts on capacity.
      for (const counters of Object.values(reads.artifacts)) Object.freeze(counters)
      Object.freeze(reads.artifacts); Object.freeze(reads)
      if (sourceCache) {
        if (signal.aborted) { sourceCache.entry = undefined; sourceCache.generation++ }
        sourceCache.busy = false
      }
    }
    // A return from the main loop still awaits speculative reads above. The
    // caller can cancel during that drain; never publish its stale success.
    // Check after releasing the cache lease and freezing terminal accounting.
    signal.throwIfAborted()
  }
}
