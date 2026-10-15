import { readBoundedStream } from '../../data/cache/boundedStream'
import { fetchImmutableArrayBuffer, parseMaybeGzipJson } from '../../data/cache/indexedDb'
import { evaluateApproximation, segmentAt, type ApproximationSegment } from './segmentedApproximation'
import { utcJulianDayToEt } from './timeScales'
import type { CelestialBody } from '../../types'
import { propagateTwoBody, type ForecastWindow } from './twoBodyForecast'
import { decodeApproximationBinary } from './approximationBinary'

export type ApproximationChunk = { path: string; bytes: number; sha256: string; startEt: number; endEt: number;
  segmentCount: number; sampledPositionErrorKm: number; sampledVelocityErrorKmS: number; encoding?: 'binary-chebyshev-v1' }
export type ApproximationBody = { id: string; parentId: string; origin?: boolean; seedModel: boolean;
  available: boolean; chunks: ApproximationChunk[]; missingIntervals: number[][]; forecasts?: ForecastWindow[];
  index?: { path: string; bytes: number; sha256: string; windows: [number, number][] } }
export type ApproximationManifest = { schemaVersion: 1; model: string; frame: 'ECLIPJ2000'; timeScale: 'TDB';
  positionUnit: 'km'; velocityUnit: 'km/s'; sourceManifestSha256: string; validation: string;
  positionToleranceKm: number; velocityToleranceKmS: number; bodies: ApproximationBody[]; totalBytes: number;
  bulkIndex?: { path: string; bytes: number; sha256: string } }
type ChunkDocument = { schemaVersion: 1; id: string; parentId: string; sourceManifestSha256: string;
  sourceKernelHashes: string[]; segments: ApproximationSegment[] }
const root = () => `${import.meta.env.BASE_URL}data/approximation/`
const listeners = new Set<() => void>()
let snapshot = { revision: 0, loading: 0, error: null as string | null }
let manifest: ApproximationManifest | null = null
let manifestPending: Promise<ApproximationManifest> | null = null
const bodies = new Map<string, ApproximationBody>()
const chunks = new Map<string, ChunkDocument>()
const pending = new Map<string, Promise<void>>()
const loadedIndices = new Set<string>()
const residentSizes = new Map<string, number>()
let residentBytes = 0
const digestPattern = /^[a-f0-9]{64}$/
const finite = (n: number) => Number.isFinite(n)
const emit = (patch: Partial<typeof snapshot>, invalidate = false) => {
  snapshot = { ...snapshot, ...patch, revision: snapshot.revision + Number(invalidate) }
  listeners.forEach(listener => listener())
}
export const subscribeApproximation = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const getApproximationSnapshot = () => snapshot
export const getApproximationManifest = () => manifest

function descriptorAt(body: ApproximationBody, et: number) {
  let low = 0, high = body.chunks.length
  while (low < high) { const mid = (low + high) >>> 1; if (body.chunks[mid].startEt <= et) low = mid + 1; else high = mid }
  const descriptor = body.chunks[low - 1]
  return descriptor && et <= descriptor.endEt ? descriptor : null
}

/** Stable throughout a chunk, so playback does not start a transfer per frame. */
export function approximationRequestKey(selected: readonly CelestialBody[], utcJd: number) {
  if (!manifest) return 'manifest'
  if (utcJd < 2441317.5) return 'outside-civil-time'
  const et = utcJulianDayToEt(utcJd), paths = new Set<string>(), visited = new Set<string>()
  const add = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const body = bodies.get(id)
    if (!body) return
    if (body.index) {
      // Descriptor readiness must not change the request key mid-transfer.
      // Small immutable window metadata identifies the delivery interval.
      let low = 0, high = body.index.windows.length
      while (low < high) { const mid = (low + high) >>> 1; if (body.index.windows[mid][0] <= et) low = mid + 1; else high = mid }
      const number = low - 1, window = body.index.windows[number]
      paths.add(`${body.index.path}@${window && et <= window[1] ? number : 'gap'}`)
    } else {
      const descriptor = descriptorAt(body, et)
      if (descriptor) paths.add(descriptor.path)
    }
    if (body.parentId !== id) add(body.parentId)
  }
  selected.forEach(body => { add(body.id); if (!bodies.has(body.id) && body.parentId) add(body.parentId) })
  return JSON.stringify([...paths].sort())
}

async function responseBytes(path: string, limit: number) {
  const response = await fetch(`${root()}${path.split('/').map(encodeURIComponent).join('/')}`, { redirect: 'error', cache: 'no-cache' })
  if (!response.ok || !response.body) throw new Error(`Approximation HTTP ${response.status}: ${path}`)
  const bytes = new Uint8Array(await readBoundedStream(response.body, limit))
  // Handle both gzip files and hosts that already applied Content-Encoding.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser does not support streamed gzip approximation delivery')
  return new Uint8Array(await readBoundedStream(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), limit))
}
function awaitConsumer<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    operation.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}
export async function loadApproximationManifest() {
  if (manifest) return manifest
  if (!manifestPending) manifestPending = (async () => {
    const pointer = JSON.parse(new TextDecoder().decode(await responseBytes('index.json', 1024))) as { path: string; bytes: number; sha256: string }
    if (!/^manifests\/[a-f0-9]{64}\.json\.gz$/.test(pointer.path) || !digestPattern.test(pointer.sha256)
      || pointer.path !== `manifests/${pointer.sha256}.json.gz` || !Number.isSafeInteger(pointer.bytes)
      || pointer.bytes <= 0 || pointer.bytes > 16 * 1048576) throw new Error('Invalid approximation delivery index')
    let value!: ApproximationManifest
    await fetchImmutableArrayBuffer(`${root()}${pointer.path}`, async bytes => {
      value = await parseMaybeGzipJson<ApproximationManifest>(bytes, pointer.bytes, undefined, pointer.sha256)
    })
    if (value.schemaVersion !== 1 || value.model !== 'piecewise-chebyshev-best-sampled-v1'
      || value.frame !== 'ECLIPJ2000' || value.timeScale !== 'TDB' || value.positionUnit !== 'km' || value.velocityUnit !== 'km/s'
      || !digestPattern.test(value.sourceManifestSha256) || !Array.isArray(value.bodies) || value.bodies.length > 4096
      || !finite(value.positionToleranceKm) || value.positionToleranceKm <= 0 || !finite(value.velocityToleranceKmS) || value.velocityToleranceKmS <= 0) throw new Error('Invalid static approximation manifest')
    const identities = new Set<string>()
    if (value.bulkIndex && (!/^indices\/[a-f0-9]{64}\.json\.gz$/.test(value.bulkIndex.path)
      || value.bulkIndex.path !== `indices/${value.bulkIndex.sha256}.json.gz` || !digestPattern.test(value.bulkIndex.sha256)
      || !Number.isSafeInteger(value.bulkIndex.bytes) || value.bulkIndex.bytes <= 0 || value.bulkIndex.bytes > 16 * 1048576)) throw new Error('Invalid bulk index descriptor')
    const chunkPaths = new Set<string>()
    for (const body of value.bodies) {
      if (!body.id || identities.has(body.id) || !body.parentId || !Array.isArray(body.chunks) || body.chunks.length > 4096
        || typeof body.available !== 'boolean' || typeof body.seedModel !== 'boolean') throw new Error('Invalid approximation body')
      identities.add(body.id)
      if (body.index && (!/^indices\/[a-f0-9]{64}\.json\.gz$/.test(body.index.path)
        || body.index.path !== `indices/${body.index.sha256}.json.gz` || !digestPattern.test(body.index.sha256)
        || !Number.isSafeInteger(body.index.bytes) || body.index.bytes <= 0 || body.index.bytes > 2 * 1048576
        || !Array.isArray(body.index.windows) || !body.index.windows.length || body.index.windows.length > 4096
        || body.index.windows.some((window, number, windows) => !Array.isArray(window) || window.length !== 2
          || !window.every(finite) || window[1] <= window[0] || number > 0 && window[0] < windows[number - 1][1])
        || body.chunks.length)) throw new Error('Invalid approximation body index')
      if (body.forecasts !== undefined) {
        if (!Array.isArray(body.forecasts) || body.forecasts.length > 512) throw new Error('Invalid forecast budget')
        let end = -Infinity
        for (const forecast of body.forecasts) {
          if (forecast.model !== 'two-body-universal' || forecast.uncertainty !== 'unknown-outside-source-coverage'
            || ![forecast.startEt, forecast.endEt, forecast.seedEt, forecast.gmKm3S2].every(finite)
            || forecast.startEt < end || forecast.endEt <= forecast.startEt || forecast.gmKm3S2 <= 0
            || !forecast.parameterSource || !forecast.sourceHashes?.length || forecast.sourceHashes.some(hash => !digestPattern.test(hash))
            || !['source-fit', 'horizons-vector'].includes(forecast.anchorSource)
            || !forecast.sourceUrls?.length || forecast.sourceUrls.some(url => !/^https:\/\//.test(url))
            || !forecast.seed?.position || !forecast.seed?.velocity
            || !(['x', 'y', 'z'] as const).every(axis => finite(forecast.seed.position[axis]) && finite(forecast.seed.velocity[axis]))
            || !Number.isSafeInteger(forecast.backtest?.samples) || forecast.backtest.samples < 0
            || !finite(forecast.backtest.maximumOffsetDays) || forecast.backtest.maximumOffsetDays < 0
            || [forecast.backtest.maximumPositionErrorKm, forecast.backtest.maximumVelocityErrorKmS].some(value => value !== null && (!finite(value) || value < 0))) throw new Error('Invalid forecast provenance, state or backtest')
          end = forecast.endEt
          if (body.chunks.some(chunk => forecast.startEt < chunk.endEt && forecast.endEt > chunk.startEt)) throw new Error('Forecast overlaps a source-fit interval')
        }
      }
      let end = -Infinity
      for (const chunk of body.chunks) {
        if (!/^chunks\/[a-zA-Z0-9:%._-]+\.(?:json|bin)(?:\.gz)?$/.test(chunk.path) || chunkPaths.has(chunk.path) || !digestPattern.test(chunk.sha256)
          || chunk.encoding !== undefined && chunk.encoding !== 'binary-chebyshev-v1'
          || !Number.isSafeInteger(chunk.bytes) || chunk.bytes <= 0 || chunk.bytes > 16 * 1048576
          || !finite(chunk.startEt) || !finite(chunk.endEt) || chunk.startEt < end || chunk.endEt <= chunk.startEt) throw new Error('Invalid approximation chunk')
        end = chunk.endEt
        chunkPaths.add(chunk.path)
      }
    }
    const byId = new Map(value.bodies.map(body => [body.id, body]))
    for (const body of value.bodies) {
      const seen = new Set<string>()
      let current = body
      while (current.parentId !== current.id) {
        if (seen.has(current.id)) throw new Error('Cyclic approximation centers')
        seen.add(current.id)
        const parent = byId.get(current.parentId)
        if (!parent) throw new Error('Missing approximation center')
        current = parent
      }
      if (current.id !== 'sun' || !current.origin) throw new Error('Invalid approximation origin')
    }
    for (const body of value.bodies) bodies.set(body.id, body)
    manifest = value; emit({}, true); return value
  })().catch(error => { manifestPending = null; throw error })
  return manifestPending
}
type BodyIndexDocument = { schemaVersion: number; id: string; parentId: string; sourceManifestSha256: string; chunks: ApproximationChunk[] }
function validateBodyIndex(body: ApproximationBody, document: BodyIndexDocument) {
  if (document.schemaVersion !== 1 || document.id !== body.id || document.parentId !== body.parentId
    || document.sourceManifestSha256 !== manifest!.sourceManifestSha256 || !Array.isArray(document.chunks)
    || document.chunks.length !== body.index!.windows.length) throw new Error('Invalid body index identity')
  let end = -Infinity
  const paths = new Set<string>()
  for (const [number, chunk] of document.chunks.entries()) {
    if (!/^chunks\/[a-zA-Z0-9:%._-]+\.(?:json|bin)(?:\.gz)?$/.test(chunk.path) || paths.has(chunk.path)
      || !digestPattern.test(chunk.sha256) || chunk.encoding !== 'binary-chebyshev-v1'
      || !Number.isSafeInteger(chunk.bytes) || chunk.bytes <= 0 || chunk.bytes > 16 * 1048576
      || !finite(chunk.startEt) || !finite(chunk.endEt) || chunk.startEt < end || chunk.endEt <= chunk.startEt
      || !Number.isSafeInteger(chunk.segmentCount) || chunk.segmentCount <= 0
      || chunk.startEt !== body.index!.windows[number][0] || chunk.endEt !== body.index!.windows[number][1]
      || body.forecasts?.some(forecast => forecast.startEt < chunk.endEt && forecast.endEt > chunk.startEt)) throw new Error('Invalid body index descriptor')
    paths.add(chunk.path); end = chunk.endEt
  }
}

async function loadBulkIndex() {
  const descriptor = manifest?.bulkIndex
  if (!descriptor) return
  if (!pending.has(descriptor.path)) {
    const promise = (async () => {
      let document!: ApproximationManifest
      await fetchImmutableArrayBuffer(root() + descriptor.path, async bytes => {
        document = await parseMaybeGzipJson(bytes, descriptor.bytes, undefined, descriptor.sha256)
      })
      if (document.schemaVersion !== 1 || document.sourceManifestSha256 !== manifest!.sourceManifestSha256
        || !Array.isArray(document.bodies) || document.bodies.length !== bodies.size) throw new Error('Invalid bulk index identity')
      const selected = new Map<string, ApproximationChunk[]>()
      const seen = new Set<string>()
      for (const entry of document.bodies) {
        const body = bodies.get(entry.id)
        if (!body || seen.has(entry.id) || entry.parentId !== body.parentId) throw new Error('Invalid bulk index body')
        seen.add(entry.id)
        if (!body.index) {
          if (entry.chunks.length) throw new Error('Unexpected bulk index chunks')
          continue
        }
        validateBodyIndex(body, { ...entry, schemaVersion: document.schemaVersion, sourceManifestSha256: document.sourceManifestSha256 })
        selected.set(body.id, entry.chunks)
      }
      // Validate every identity before installing any descriptors. Bulk delivery
      // changes request granularity, never coefficient admission or coverage.
      for (const [id, descriptors] of selected) { bodies.get(id)!.chunks = descriptors; loadedIndices.add(id) }
    })().finally(() => pending.delete(descriptor.path))
    pending.set(descriptor.path, promise)
  }
  await pending.get(descriptor.path)
}

async function loadBodyIndex(body: ApproximationBody) {
  const index = body.index
  if (!index || loadedIndices.has(body.id)) return
  if (!pending.has(index.path)) {
    const promise = (async () => {
      emit({ loading: snapshot.loading + 1 })
      try {
        let document!: { schemaVersion: number; id: string; parentId: string; sourceManifestSha256: string; chunks: ApproximationChunk[] }
        await fetchImmutableArrayBuffer(`${root()}${index.path}`, async bytes => {
          document = await parseMaybeGzipJson(bytes, index.bytes, undefined, index.sha256)
        })
        validateBodyIndex(body, document)
        body.chunks = document.chunks; loadedIndices.add(body.id)
      } catch (error) {
        emit({ error: error instanceof Error ? error.message : String(error) }); throw error
      } finally { emit({ loading: snapshot.loading - 1 }); pending.delete(index.path) }
    })()
    pending.set(index.path, promise)
  }
  await pending.get(index.path)
}
async function loadChunk(body: ApproximationBody, descriptor: ApproximationChunk) {
  if (chunks.has(descriptor.path)) return
  if (!pending.has(descriptor.path)) {
    const promise = (async () => {
      emit({ loading: snapshot.loading + 1 })
      try {
        const url = `${root()}${descriptor.path.split('/').map(encodeURIComponent).join('/')}`
        let value!: ChunkDocument
        await fetchImmutableArrayBuffer(url, async bytes => {
          if (descriptor.encoding !== 'binary-chebyshev-v1') {
            value = await parseMaybeGzipJson<ChunkDocument>(bytes, descriptor.bytes, undefined, descriptor.sha256)
            return
          }
          let raw = new Uint8Array(bytes)
          if (raw[0] === 0x1f && raw[1] === 0x8b) {
            raw = new Uint8Array(await readBoundedStream(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip')), descriptor.bytes))
          }
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(byte => byte.toString(16).padStart(2, '0')).join('')
          if (raw.byteLength !== descriptor.bytes || hash !== descriptor.sha256) throw new Error('Approximation binary SHA-256 mismatch')
          value = decodeApproximationBinary(raw) as ChunkDocument
        })
        if (value.schemaVersion !== 1 || value.id !== body.id || value.parentId !== body.parentId
          || value.sourceManifestSha256 !== manifest!.sourceManifestSha256 || !Array.isArray(value.segments)
          || value.segments.length !== descriptor.segmentCount || !value.sourceKernelHashes?.length
          || value.sourceKernelHashes.some(hash => !digestPattern.test(hash))) throw new Error('Invalid approximation chunk identity')
        let end = -Infinity
        for (const segment of value.segments) {
          if (!finite(segment.startEt) || !finite(segment.endEt) || segment.startEt < end || segment.endEt <= segment.startEt
            || !Array.isArray(segment.coefficients) || segment.coefficients.length !== 3
            || segment.coefficients.some(axis => !Array.isArray(axis) || ![9, 13, 17].includes(axis.length) || axis.some(n => !finite(n)))
            || !finite(segment.sampledPositionErrorKm) || segment.sampledPositionErrorKm < 0 || segment.sampledPositionErrorKm > manifest!.positionToleranceKm
            || !finite(segment.sampledVelocityErrorKmS) || segment.sampledVelocityErrorKmS < 0 || segment.sampledVelocityErrorKmS > manifest!.velocityToleranceKmS) throw new Error('Invalid approximation coefficients or error receipt')
          end = segment.endEt
        }
        if (value.segments[0]?.startEt !== descriptor.startEt || end !== descriptor.endEt) throw new Error('Approximation window differs from descriptor')
        // Only one window and selected history are retained, not the full
        // multi-decade archive. FIFO eviction bounds each main/worker realm.
        while (residentBytes + descriptor.bytes > 128 * 1048576 && chunks.size) {
          const path = chunks.keys().next().value!
          residentBytes -= residentSizes.get(path)!; chunks.delete(path); residentSizes.delete(path)
        }
        chunks.set(descriptor.path, value); residentBytes += descriptor.bytes
        residentSizes.set(descriptor.path, descriptor.bytes)
        emit({ error: null })
      } finally { emit({ loading: snapshot.loading - 1 }); pending.delete(descriptor.path) }
    })()
    pending.set(descriptor.path, promise)
  }
  await pending.get(descriptor.path)
}

export async function ensureApproximation(builtIns: readonly CelestialBody[], startUtcJd: number, endUtcJd = startUtcJd, signal?: AbortSignal) {
  signal?.throwIfAborted()
  emit({ loading: snapshot.loading + 1 })
  try { await ensureWindow(builtIns, startUtcJd, endUtcJd, signal) }
  finally { emit({ loading: snapshot.loading - 1 }) }
}

async function ensureWindow(builtIns: readonly CelestialBody[], startUtcJd: number, endUtcJd: number, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (endUtcJd < startUtcJd) throw new RangeError('Invalid approximation window')
  await awaitConsumer(loadApproximationManifest(), signal)
  signal?.throwIfAborted()
  if (endUtcJd < 2441317.5) return
  startUtcJd = Math.max(startUtcJd, 2441317.5)
  const startEt = utcJulianDayToEt(startUtcJd), endEt = utcJulianDayToEt(endUtcJd)
  const required = new Map<string, ApproximationBody>()
  const add = (id: string) => {
    const body = bodies.get(id)
    if (!body || required.has(id)) return
    required.set(id, body)
    if (body.parentId !== id) add(body.parentId)
  }
  builtIns.forEach(body => { add(body.id); if (!bodies.has(body.id) && body.parentId) add(body.parentId) })
  const indices = [...required.values()]
  if (manifest!.bulkIndex && indices.filter(body => body.index && !loadedIndices.has(body.id)).length >= 128) {
    await awaitConsumer(loadBulkIndex(), signal)
    signal?.throwIfAborted()
  }
  let nextIndex = 0
  await Promise.all(Array.from({ length: Math.min(4, indices.length) }, async () => {
    while (nextIndex < indices.length) {
      signal?.throwIfAborted()
      await awaitConsumer(loadBodyIndex(indices[nextIndex++]), signal)
    }
  }))
  const descriptors = [...required.values()].flatMap(body => {
    const point = startEt === endEt ? descriptorAt(body, startEt) : null
    const selected = startEt === endEt ? point ? [point] : [] : body.chunks.filter(chunk => chunk.startEt <= endEt && chunk.endEt >= startEt)
    return selected.map(chunk => ({ body, chunk }))
  })
  if (descriptors.reduce((sum, { chunk }) => sum + chunk.bytes, 0) > 128 * 1048576) {
    const error = 'Selected approximation window exceeds the 128 MiB coefficient budget'
    emit({ error }); throw new Error(error)
  }
  const requests = descriptors.map(({ body, chunk }) => () => loadChunk(body, chunk))
  let next = 0
  try {
    await Promise.all(Array.from({ length: Math.min(4, requests.length) }, async () => { while (next < requests.length) { signal?.throwIfAborted(); await awaitConsumer(requests[next++](), signal) } }))
    signal?.throwIfAborted()
    // Publish one coherent requested window. Per-index/chunk invalidations
    // repeatedly rebuilt every selected trajectory during large cold loads.
    emit({ error: null }, true)
  } catch (error) { if (!signal?.aborted) emit({ error: error instanceof Error ? error.message : String(error) }); throw error }
}
export function approximationForBody(id: string, utcJd: number) {
  const body = bodies.get(id)
  if (!body) return { body: null, state: null, segment: null, forecast: null }
  if (utcJd < 2441317.5) return { body, state: null, segment: null, forecast: null }
  const et = utcJulianDayToEt(utcJd)
  if (body.index && !loadedIndices.has(id)) return { body, state: null, segment: null, forecast: null }
  const descriptor = descriptorAt(body, et)
  const document = descriptor && chunks.get(descriptor.path)
  const segment = document ? segmentAt(document.segments, et) : null
  const forecast = !descriptor ? body.forecasts?.find(window => window.startEt <= et && window.endEt >= et) ?? null : null
  return { body, segment, forecast, state: segment ? evaluateApproximation(segment, et) : forecast
    ? propagateTwoBody(forecast.seed, forecast.gmKm3S2, et - forecast.seedEt) : null }
}

/** Parent forecasts affect a child's absolute state too. */
export function predictionForBody(id: string, utcJd: number, seen = new Set<string>()): ForecastWindow | null {
  if (seen.has(id)) return null
  seen.add(id)
  const result = approximationForBody(id, utcJd)
  return result.forecast ?? (result.body && result.body.parentId !== id ? predictionForBody(result.body.parentId, utcJd, seen) : null)
}
