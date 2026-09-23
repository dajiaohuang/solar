import { catalogAdmission } from '../data/cache/catalogAdmission'
import { readBoundedStream } from '../data/cache/boundedStream'
import { prepareCatalogElements, propagatePreparedCatalogPositions } from '../engine/ephemeris/catalogPoints'
import { utcJulianDayToTt } from '../engine/ephemeris/timeScales'
import { createCatalogFieldMatcher } from './catalogFilters'
import { validateBinaryElements } from './catalogLoader'
import type { AsteroidManifest, CatalogFilters } from '../types'

export const CATALOG_STREAM_CONCURRENCY = 4
export const CATALOG_STREAM_ARTIFACT_TIMEOUT_MS = 30_000
export type CatalogStreamPriority = 'source' | 'neo-first' | 'pha-first'
const MIB = 1024 * 1024
export type CatalogStreamPlan = { capacity: number; budgetBytes: number; reservedBytes: number }
export type CatalogStreamTile = {
  positions: Float64Array
  appearance: Uint8Array
  sourceRows: number
  drawnRows: number
}
export type CatalogStreamResult = { sourceRows: number; drawnRows: number; complete: boolean }
type Checksums = { schemaVersion: number; algorithm: string; files: Record<string, string> }

export function planCatalogStream(manifest: AsteroidManifest, requestedRows: number, budgetBytes: number, mode: '2d' | '3d' = '2d'): CatalogStreamPlan {
  if (mode !== '2d' && mode !== '3d') throw new Error('Invalid catalog streaming dimension')
  const { compactIndex: compact, totalCount, chunkSize, chunkCount } = manifest
  if (manifest.format !== 'binary-v1' || !compact || compact.format !== 'catalog-index-v1' || compact.strideBytes !== 24 || compact.count !== totalCount ||
      !Number.isSafeInteger(totalCount) || totalCount < 1 || !Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 65_536 ||
      !Number.isSafeInteger(chunkCount) || chunkCount !== Math.ceil(totalCount / chunkSize) || chunkCount > 65_536 ||
      !Array.isArray(compact.classCodes) || !compact.classCodes.length || compact.classCodes.length > 256 || compact.classCodes.some(code => typeof code !== 'string') ||
      !/^[a-zA-Z0-9_-]+\.bin$/.test(compact.path) || !manifest.releasePath) throw new Error('Unsupported catalog streaming manifest')
  if (!Number.isSafeInteger(requestedRows) || requestedRows < 1 || !Number.isSafeInteger(budgetBytes) || budgetBytes < 1 || budgetBytes > 512 * MIB) throw new Error('Invalid catalog streaming budget')
  // Explicit typed-array / GPU allocations, not total browser RSS: index read
  // plus concatenation, optional query locators + bitset, four in-flight shards
  // and their compute/transfer scratch, checksum parsing reserve. GPU attributes
  // and a CPU copy for context restoration use 48 bytes per point. Spatial
  // positions, index scratch and CPU/GPU selections reserve another 24 bytes.
  const fixed = totalCount * (48 + 9) + CATALOG_STREAM_CONCURRENCY * chunkSize * 256 + 8 * MIB
  // 3D adds one Float32 coordinate in both CPU/GPU attributes and worker culling.
  const perPoint = mode === '3d' ? 84 : 72
  const capacity = Math.min(totalCount, requestedRows, Math.max(0, Math.floor((budgetBytes - fixed) / perPoint)))
  return { capacity, budgetBytes, reservedBytes: fixed + capacity * perPoint }
}

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** HTTP caching remains available; this path avoids unbounded asynchronous
 * IndexedDB writes and does not hydrate any per-object metadata records. */
async function fetchArtifact(url: string, maximumBytes: number, expectedHash: string | undefined, signal: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  // Include admission wait and body consumption, not just response headers.
  const timer = setTimeout(() => controller.abort(new DOMException('Catalog artifact exceeded its 30-second deadline', 'TimeoutError')), CATALOG_STREAM_ARTIFACT_TIMEOUT_MS)
  let release: (() => void) | undefined
  try {
    release = await catalogAdmission.acquire(controller.signal)
    controller.signal.throwIfAborted()
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Failed to load catalog artifact: ${response.status}`)
    if (Number(response.headers.get('content-length')) > maximumBytes) {
      void response.body?.cancel().catch(() => undefined)
      throw new Error('Catalog artifact exceeds its declared capacity')
    }
    const buffer = response.body ? await readBoundedStream(response.body, maximumBytes, controller.signal) : new ArrayBuffer(0)
    if (expectedHash !== undefined && await sha256(buffer) !== expectedHash) throw new Error('Catalog artifact SHA-256 mismatch')
    controller.signal.throwIfAborted()
    return buffer
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    release?.()
  }
}

type StreamOptions = {
  priority?: CatalogStreamPriority
  mode?: '2d' | '3d'
  manifest: AsteroidManifest
  filters: CatalogFilters
  julianDay: number
  requestedRows: number
  budgetBytes: number
  candidateLocators?: Uint32Array
  signal: AbortSignal
  // Awaiting this callback is the backpressure boundary: the worker's bounded
  // transfer window admits further work only while upload credits remain.
  onTile: (tile: CatalogStreamTile) => Promise<void>
}

export async function streamCatalogPoints(options: StreamOptions): Promise<CatalogStreamResult> {
  const { manifest, filters, signal, onTile } = options
  signal.throwIfAborted()
  const priority = options.priority ?? 'source'
  if (!['source', 'neo-first', 'pha-first'].includes(priority)) throw new Error('Invalid catalog source priority')
  const priorityFlag = priority === 'neo-first' ? 1 : priority === 'pha-first' ? 2 : 0
  if (!Number.isFinite(options.julianDay) || options.julianDay < 2441317.5) throw new Error('Catalog streaming requires a UTC epoch from 1972 onwards')
  const mode = options.mode ?? '2d', stride = mode === '3d' ? 3 : 2
  const plan = planCatalogStream(manifest, options.requestedRows, options.budgetBytes, mode)
  if (!plan.capacity) throw new Error('The catalog index exceeds the available streaming budget')
  if (filters.query.trim() && !options.candidateLocators) throw new Error('Catalog name search requires exact source locators')
  const ranges = [filters.semiMajorAxis, filters.eccentricity, filters.inclination, filters.absoluteMagnitude, filters.perihelion]
  if (ranges.some(range => range.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1])) throw new Error('Invalid catalog filter interval')
  const compact = manifest.compactIndex!, root = manifest.releasePath!.replace(/\/$/, '')
  let candidates: Uint8Array | undefined
  if (options.candidateLocators) {
    const locators = options.candidateLocators
    if (locators.length % 2 || locators.length > manifest.totalCount * 2) throw new Error('Invalid source locator capacity')
    candidates = new Uint8Array(Math.ceil(manifest.totalCount / 8))
    for (let i = 0; i < locators.length; i += 2) {
      const chunk = locators[i], row = locators[i + 1], offset = chunk * manifest.chunkSize + row
      if (chunk >= manifest.chunkCount || row >= manifest.chunkSize || offset >= manifest.totalCount) throw new Error('Invalid source locator')
      candidates[offset >> 3] |= 1 << (offset & 7)
    }
  }
  const hasCandidate = (row: number) => !candidates || Boolean(candidates[row >> 3] & (1 << (row & 7)))
  const controller = new AbortController(), abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  const pending = new Map<number, Promise<{ buffer: ArrayBuffer } | { error: unknown }>>()
  try {
    signal.throwIfAborted()
    const checksums = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fetchArtifact(`${root}/checksums.json`, 2 * MIB, undefined, controller.signal))) as Checksums
    if (checksums.schemaVersion !== 1 || checksums.algorithm !== 'sha256' || !checksums.files || typeof checksums.files !== 'object') throw new Error('Unsupported catalog checksums')
    const hash = (path: string) => {
      const value = checksums.files[path]
      if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`Missing catalog checksum: ${path}`)
      return value
    }
    const indexBuffer = await fetchArtifact(`${root}/${compact.path}`, manifest.totalCount * 24, hash(compact.path), controller.signal)
    if (indexBuffer.byteLength !== manifest.totalCount * 24) throw new Error('Incomplete compact catalog index')
    const index = new DataView(indexBuffer)
    // Only exact index fields may exclude a shard. The quantized e/i columns
    // cannot decide source-precision boundaries (including perihelion).
    const matchesIndex = createCatalogFieldMatcher({ ...filters, query: '',
      eccentricity: [0, 1], inclination: [0, 180], perihelion: [0, Number.MAX_VALUE] })
    const chunks: number[] = [], deferredChunks: number[] = []
    let inspected = 0
    for (let chunk = 0; chunk < manifest.chunkCount; chunk++) {
      signal.throwIfAborted()
      let admitted = false, preferred = false
      const end = Math.min(manifest.totalCount, (chunk + 1) * manifest.chunkSize)
      for (let row = chunk * manifest.chunkSize; row < end; row++) {
        if (++inspected % 20_000 === 0) {
          await new Promise<void>(resolve => setTimeout(resolve, 0))
          signal.throwIfAborted()
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
    const enqueue = (sequence: number) => {
      if (sequence >= chunks.length) return
      const chunk = chunks[sequence], path = `binary/chunk-${String(chunk).padStart(4, '0')}.bin`
      const count = Math.min(manifest.chunkSize, manifest.totalCount - chunk * manifest.chunkSize)
      pending.set(sequence, fetchArtifact(`${root}/${path}`, count * 64, hash(path), controller.signal).then(buffer => ({ buffer }), error => ({ error })))
    }
    for (let i = 0; i < Math.min(chunks.length, CATALOG_STREAM_CONCURRENCY); i++) enqueue(i)
    const matches = createCatalogFieldMatcher({ ...filters, query: '' })
    const epochTt = utcJulianDayToTt(options.julianDay)
    let sourceRows = 0, drawnRows = 0
    for (let sequence = 0; sequence < chunks.length; sequence++) {
      const loaded = await pending.get(sequence)!
      pending.delete(sequence)
      signal.throwIfAborted()
      if ('error' in loaded) throw loaded.error
      const elements = new Float64Array(loaded.buffer), chunk = chunks[sequence]
      const count = Math.min(manifest.chunkSize, manifest.totalCount - chunk * manifest.chunkSize)
      if (elements.length !== count * 8) throw new Error('Incomplete catalog element shard')
      validateBinaryElements(loaded.buffer)
      const selected = new Float64Array(count * 8), appearance = new Uint8Array(count * 2)
      let used = 0, truncated = false
      for (let row = 0; row < count; row++) {
        const sourceRow = chunk * manifest.chunkSize + row, offset = sourceRow * 24, orbit = row * 8
        sourceRows++
        if (index.getUint16(offset + 20, true) !== chunk || index.getUint16(offset + 22, true) !== row) throw new Error('Catalog index locator mismatch')
        const classIndex = index.getUint8(offset + 18), flags = index.getUint8(offset + 19), magnitude = index.getInt16(offset + 16, true)
        if (classIndex >= compact.classCodes.length || flags > 7 || Boolean(flags & 4) !== (magnitude !== 0x7fff)) throw new Error('Invalid catalog appearance metadata')
        // Check index/source alignment, then filter a/e/i using the Float64
        // source fields; index quantization must not move a filter boundary.
        if (index.getFloat64(offset, true) !== elements[orbit + 1] || index.getUint32(offset + 8, true) !== Math.round(elements[orbit + 2] * 1e9) || index.getUint32(offset + 12, true) !== Math.round(elements[orbit + 3] * 1e6)) throw new Error('Catalog index orbital fields mismatch')
        if (!hasCandidate(sourceRow) || !matches('', compact.classCodes[classIndex], magnitude === 0x7fff ? undefined : magnitude / 100, elements[orbit + 1], elements[orbit + 2], elements[orbit + 3])) continue
        if (drawnRows + used >= plan.capacity) { truncated = true; break }
        // Preserve each Float64 source value without allocating a typed-array
        // view for every retained body (1.56 million views at the full tier).
        const target = used * 8
        for (let column = 0; column < 8; column++) selected[target + column] = elements[orbit + column]
        appearance[used * 2] = classIndex; appearance[used * 2 + 1] = flags
        used++
      }
      const prepared = prepareCatalogElements(selected.subarray(0, used * 8))
      const positions = propagatePreparedCatalogPositions(prepared, epochTt, mode, new Float64Array(used * stride))
      drawnRows += used
      await onTile({ positions, appearance: appearance.slice(0, used * 2), sourceRows, drawnRows })
      signal.throwIfAborted()
      if (drawnRows >= plan.capacity) return { sourceRows, drawnRows, complete: !truncated && sequence === chunks.length - 1 }
      enqueue(sequence + CATALOG_STREAM_CONCURRENCY)
    }
    return { sourceRows, drawnRows, complete: true }
  } finally {
    signal.removeEventListener('abort', abort)
    controller.abort()
    await Promise.all(pending.values())
  }
}
