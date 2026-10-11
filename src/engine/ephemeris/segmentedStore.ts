import { readBoundedStream } from '../../data/cache/boundedStream'
import { fetchImmutableArrayBuffer, parseMaybeGzipJson } from '../../data/cache/indexedDb'
import { evaluateApproximation, segmentAt, type ApproximationSegment } from './segmentedApproximation'
import { utcJulianDayToEt } from './timeScales'
import type { CelestialBody } from '../../types'

export type ApproximationChunk = { path: string; bytes: number; sha256: string; startEt: number; endEt: number;
  segmentCount: number; sampledPositionErrorKm: number; sampledVelocityErrorKmS: number }
export type ApproximationBody = { id: string; parentId: string; origin?: boolean; seedModel: boolean;
  available: boolean; chunks: ApproximationChunk[]; missingIntervals: number[][] }
export type ApproximationManifest = { schemaVersion: 1; model: string; frame: 'ECLIPJ2000'; timeScale: 'TDB';
  positionUnit: 'km'; velocityUnit: 'km/s'; sourceManifestSha256: string; validation: string;
  positionToleranceKm: number; velocityToleranceKmS: number; bodies: ApproximationBody[]; totalBytes: number }
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
    const descriptor = descriptorAt(body, et)
    if (descriptor) paths.add(descriptor.path)
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
    const chunkPaths = new Set<string>()
    for (const body of value.bodies) {
      if (!body.id || identities.has(body.id) || !body.parentId || !Array.isArray(body.chunks) || body.chunks.length > 4096
        || typeof body.available !== 'boolean' || typeof body.seedModel !== 'boolean') throw new Error('Invalid approximation body')
      identities.add(body.id)
      let end = -Infinity
      for (const chunk of body.chunks) {
        if (!/^chunks\/[a-zA-Z0-9:%._-]+\.json(?:\.gz)?$/.test(chunk.path) || chunkPaths.has(chunk.path) || !digestPattern.test(chunk.sha256)
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
async function loadChunk(body: ApproximationBody, descriptor: ApproximationChunk) {
  if (chunks.has(descriptor.path)) return
  if (!pending.has(descriptor.path)) {
    const promise = (async () => {
      emit({ loading: snapshot.loading + 1 })
      try {
        const url = `${root()}${descriptor.path.split('/').map(encodeURIComponent).join('/')}`
        let value!: ChunkDocument
        await fetchImmutableArrayBuffer(url, async bytes => {
          value = await parseMaybeGzipJson<ChunkDocument>(bytes, descriptor.bytes, undefined, descriptor.sha256)
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
        emit({ error: null }, true)
      } finally { emit({ loading: snapshot.loading - 1 }); pending.delete(descriptor.path) }
    })()
    pending.set(descriptor.path, promise)
  }
  await pending.get(descriptor.path)
}

export async function ensureApproximation(builtIns: readonly CelestialBody[], startUtcJd: number, endUtcJd = startUtcJd, signal?: AbortSignal) {
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
  } catch (error) { if (!signal?.aborted) emit({ error: error instanceof Error ? error.message : String(error) }); throw error }
}
export function approximationForBody(id: string, utcJd: number) {
  const body = bodies.get(id)
  if (!body) return { body: null, state: null, segment: null }
  if (utcJd < 2441317.5) return { body, state: null, segment: null }
  const et = utcJulianDayToEt(utcJd)
  const descriptor = descriptorAt(body, et)
  const document = descriptor && chunks.get(descriptor.path)
  const segment = document ? segmentAt(document.segments, et) : null
  return { body, segment, state: segment ? evaluateApproximation(segment, et) : null }
}
