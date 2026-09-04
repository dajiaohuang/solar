import { useEffect, useMemo, useRef, useState } from 'react'
import { utcJulianDayToTdb } from '../engine/ephemeris/timeScales'
import { PRODUCT_PROFILE } from '../lib/productAvailability'
import type { BodyId, CelestialBody } from '../types'
import {
  backendBodyId,
  buildBackendFrame,
  MAX_CURRENT_STATE_BATCH,
  splitCurrentStateBatches,
  validateCapabilities,
  validateCurrentStates,
  type BackendCapabilities,
  type BackendFrame,
  type CurrentStatesResponse,
} from '../lib/currentStates'

type FetchLike = typeof fetch
type Shared<T> = { promise: Promise<T>; controller: AbortController; consumers: number; settled: boolean; touchedAt: number }
const capabilityCache = new Map<string, Shared<BackendCapabilities>>()
const responseCache = new Map<string, Shared<CurrentStatesResponse>>()
const MAX_CAPABILITY_CACHE = 2
const MAX_RESPONSE_CACHE = 16
// Capabilities are cheap metadata and are refreshed periodically. A response
// identity mismatch also invalidates this entry immediately (see below).
const CAPABILITY_TTL_MS = 60_000
export const CURRENT_STATE_PLAYING_SAMPLE_MS = 500

// This helper deliberately never quantizes the scientific epoch. Sampling is
// a wall-clock scheduling concern; every request still carries the latest
// exact UTC epoch observed by SimulationClock.
export function sampleCurrentStateEpoch(epochUtcJd: number, isPlaying: boolean) {
  // Both modes carry the exact epoch; `isPlaying` is consumed to make this
  // boundary explicit while wall-clock cadence is handled by the hook.
  if (!isPlaying) return epochUtcJd
  return epochUtcJd
}

export function currentStateRequestToken(params: { isPlaying: boolean; sample: number; epochUtcJd: number; seekRevision: number }) {
  return params.isPlaying
    ? `playing:${params.sample}:seek:${params.seekRevision}`
    : `paused:${params.epochUtcJd}:seek:${params.seekRevision}`
}

function apiBase() {
  const configured = import.meta.env.VITE_SOLAR_API_BASE_URL
  return typeof configured === 'string' && configured.trim() ? configured.trim().replace(/\/+$/, '') : null
}

export function resetCurrentStatesCaches() {
  for (const entry of [...capabilityCache.values(), ...responseCache.values()]) entry.controller.abort()
  capabilityCache.clear()
  responseCache.clear()
}

function raceAbort<T>(shared: Shared<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    if (shared.consumers === 0 && !shared.settled) shared.controller.abort()
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }
  shared.consumers += 1
  shared.touchedAt = Date.now()
  const release = () => {
    if (shared.consumers > 0) shared.consumers -= 1
    if (shared.consumers === 0 && !shared.settled) shared.controller.abort()
  }
  return new Promise<T>((resolve, reject) => {
    let done = false
    const finish = (fn: () => void) => { if (done) return; done = true; signal.removeEventListener('abort', abort); release(); fn() }
    const abort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')))
    signal.addEventListener('abort', abort, { once: true })
    shared.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)))
  })
}

function sharedFetch<T>(cache: Map<string, Shared<T>>, key: string, start: (signal: AbortSignal) => Promise<T>, maxEntries: number, ttlMs = Infinity, retainSettled = true) {
  const existing = cache.get(key)
  if (existing && !existing.controller.signal.aborted && (existing.consumers > 0 || (ttlMs > 0 && Date.now() - existing.touchedAt <= ttlMs))) { existing.touchedAt = Date.now(); cache.delete(key); cache.set(key, existing); return existing }
  if (existing) { existing.controller.abort(); cache.delete(key) }
  const controller = new AbortController()
  const shared: Shared<T> = { controller, consumers: 0, settled: false, touchedAt: Date.now(), promise: start(controller.signal) }
  cache.set(key, shared)
  while (cache.size > maxEntries) {
    let oldestKey: string | undefined
    let oldest: Shared<T> | undefined
    for (const [candidateKey, candidate] of cache) {
      if (candidate.consumers > 0) continue
      if (!oldest || candidate.touchedAt < oldest.touchedAt) { oldestKey = candidateKey; oldest = candidate }
    }
    if (!oldestKey || !oldest) break
    oldest.controller.abort()
    cache.delete(oldestKey)
  }
  void shared.promise.then(() => { shared.settled = true; if (!retainSettled && cache.get(key) === shared) cache.delete(key) }, () => { shared.settled = true; if (cache.get(key) === shared) cache.delete(key) })
  return shared
}

async function loadCapabilities(base: string, fetcher: FetchLike, signal: AbortSignal) {
  const shared = sharedFetch(capabilityCache, base, internalSignal => fetcher(`${base}/v1/capabilities`, { signal: internalSignal }).then(async response => {
    if (!response.ok) throw new Error(`Capabilities HTTP ${response.status}`)
    return validateCapabilities(await response.json())
  }), MAX_CAPABILITY_CACHE, CAPABILITY_TTL_MS)
  return raceAbort(shared, signal)
}

async function fetchBatch(base: string, ids: string[], epochTdbJd: number, capabilities: BackendCapabilities, fetcher: FetchLike, signal: AbortSignal) {
  const key = `${base}|${capabilities.catalogVersion}|${capabilities.manifestSha256}|${capabilities.inventoryManifestSha256 ?? ''}|${epochTdbJd}|${ids.join(',')}`
  const shared = sharedFetch(responseCache, key, internalSignal => fetcher(`${base}/v1/current-states`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, epochJd: epochTdbJd, frame: 'ECLIPJ2000', precision: 'exact' }), signal: internalSignal,
  }).then(async response => {
    if (!response.ok) {
      const retryAfter = response.headers.get('Retry-After')
      throw new Error(`Current states HTTP ${response.status}${retryAfter ? `; retry after ${retryAfter}s` : ''}`)
    }
    return validateCurrentStates(await response.json(), capabilities, epochTdbJd, ids)
  }), MAX_RESPONSE_CACHE, Infinity, false)
  return raceAbort(shared, signal)
}

export async function fetchCurrentStates(params: {
  base: string
  ids: string[]
  epochTdbJd: number
  signal: AbortSignal
  fetcher?: FetchLike
  batches?: readonly string[][]
}): Promise<{ capabilities: BackendCapabilities; responses: CurrentStatesResponse[] }> {
  const fetcher = params.fetcher ?? fetch
  let capabilities = await loadCapabilities(params.base, fetcher, params.signal)
  const fetchAll = async () => {
    const batches = params.batches ?? splitCurrentStateBatches(params.ids, Math.min(MAX_CURRENT_STATE_BATCH, capabilities.limits.currentStateIDsMax))
    if (batches.some(batch => batch.length > capabilities.limits.currentStateIDsMax)) throw new Error('Current-state request exceeds backend limit')
    return Promise.all(batches.map(batch => fetchBatch(params.base, batch, params.epochTdbJd, capabilities, fetcher, params.signal)))
  }
  try {
    return { capabilities, responses: await fetchAll() }
  } catch (reason) {
    // A deploy can change its manifest while a capability entry is within its
    // TTL. Retry one identity mismatch with a fresh capability document; do
    // not retry overloads or arbitrary server failures.
    if (!(reason instanceof Error) || !/audit identity mismatch/i.test(reason.message)) throw reason
    const stale = capabilityCache.get(params.base)
    stale?.controller.abort()
    capabilityCache.delete(params.base)
    capabilities = await loadCapabilities(params.base, fetcher, params.signal)
    return { capabilities, responses: await fetchAll() }
  }
}

export type LatestOnlyRequest = { generation: number; controller: AbortController }

/** Small, testable gate shared by the hook's async lifecycle. Beginning a new
 * request immediately aborts its predecessor, and only the newest generation
 * can publish a frame. */
export function createLatestOnlyGate() {
  let generation = 0
  let active: LatestOnlyRequest | undefined
  return {
    begin(): LatestOnlyRequest {
      active?.controller.abort()
      const request = { generation: ++generation, controller: new AbortController() }
      active = request
      return request
    },
    isCurrent(request: LatestOnlyRequest) {
      return active === request && generation === request.generation && !request.controller.signal.aborted
    },
    cancel(request: LatestOnlyRequest) {
      request.controller.abort()
      if (active === request) active = undefined
    },
  }
}

export async function loadCurrentStateFrames(params: {
  base: string
  ids: string[]
  epochTdbJd: number
  epochUtcJd?: number
  bodies: CelestialBody[]
  requestedIds: Map<BodyId, string>
  referenceIds: BodyId[]
  signal: AbortSignal
  fetcher?: FetchLike
}): Promise<{ capabilities: BackendCapabilities; responses: CurrentStatesResponse[]; frames: ReadonlyMap<BodyId, BackendFrame>; epochUtcJd: number }> {
  const { capabilities, responses } = await fetchCurrentStates(params)
  // Promise.all in fetchCurrentStates completes every batch before this map
  // is created, so callers publish one complete snapshot or none at all.
  const frames = new Map<BodyId, BackendFrame>()
  for (const referenceId of params.referenceIds) frames.set(referenceId, buildBackendFrame({ bodies: params.bodies, referenceId, requestedIds: params.requestedIds, responses }))
  return { capabilities, responses, frames, epochUtcJd: params.epochUtcJd ?? NaN }
}

export type CurrentStateFrameSnapshot = { frames: ReadonlyMap<BodyId, BackendFrame>; publishedEpochUtcJd: number }

/** Production publication boundary: the callback is reached only after all
 * batches validate and all reference frames have been built. */
export async function loadAndPublishCurrentStateFrames(params: Parameters<typeof loadCurrentStateFrames>[0] & { publish: (snapshot: CurrentStateFrameSnapshot) => void }) {
  const { publish, ...loadParams } = params
  const loaded = await loadCurrentStateFrames(loadParams)
  publish({ frames: loaded.frames, publishedEpochUtcJd: loaded.epochUtcJd })
  return loaded
}

export function useCurrentStates(params: { bodies: CelestialBody[]; resolutionBodies: CelestialBody[]; referenceIds: BodyId[]; epochUtcJd: number; isPlaying?: boolean; seekRevision?: number }) {
  const [snapshot, setSnapshot] = useState<CurrentStateFrameSnapshot>({ frames: new Map(), publishedEpochUtcJd: NaN })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [playingSample, setPlayingSample] = useState(0)
  const latestEpochRef = useRef(params.epochUtcJd)
  useEffect(() => {
    latestEpochRef.current = params.epochUtcJd
  }, [params.epochUtcJd])
  const gate = useRef<ReturnType<typeof createLatestOnlyGate> | null>(null)
  if (gate.current == null) gate.current = createLatestOnlyGate()
  const base = apiBase()
  const requested = useMemo(() => {
    const bodyById = new Map(params.resolutionBodies.map(body => [body.id, body]))
    const required = new Map<BodyId, string>()
    const add = (id: BodyId) => {
      const body = bodyById.get(id)
      if (body) required.set(id, backendBodyId(body))
    }
    params.bodies.forEach(body => add(body.id))
    params.referenceIds.forEach(add)
    return required
  }, [params.bodies, params.referenceIds, params.resolutionBodies])
  const isPlaying = params.isPlaying === true
  // Use wall-clock cadence, never a JD bucket: at high simulation rates a JD
  // bucket would create requests faster than this bound. A pause or explicit
  // seek changes the request token immediately.
  useEffect(() => {
    if (!isPlaying) return undefined
    const timer = window.setInterval(() => setPlayingSample(value => value + 1), CURRENT_STATE_PLAYING_SAMPLE_MS)
    return () => window.clearInterval(timer)
  }, [isPlaying])
  const requestToken = currentStateRequestToken({ isPlaying, sample: playingSample, epochUtcJd: params.epochUtcJd, seekRevision: params.seekRevision ?? 0 })
  const requestKey = `${base ?? 'none'}|${requestToken}|${[...requested].map(([id, backend]) => `${id}:${backend}`).join(',')}`

  useEffect(() => {
    const request = gate.current!.begin()
    const controller = request.controller
    if (PRODUCT_PROFILE === 'preview' || !base || requested.size === 0) {
      queueMicrotask(() => {
        if (!gate.current!.isCurrent(request)) return
        setSnapshot({ frames: new Map(), publishedEpochUtcJd: NaN })
        setError(null)
        setLoading(false)
      })
      return () => gate.current!.cancel(request)
    }
    queueMicrotask(() => {
      if (!gate.current!.isCurrent(request)) return
      setLoading(true)
      setError(null)
    })
    // This is the one UTC -> TDB boundary for the Web adapter. Every batch
    // carries this exact shared epoch and no body-level conversion occurs.
    const requestEpochUtcJd = sampleCurrentStateEpoch(latestEpochRef.current, isPlaying)
    const epochTdbJd = utcJulianDayToTdb(requestEpochUtcJd)
    const ids = [...requested.values()]
    void loadAndPublishCurrentStateFrames({ base, ids, epochTdbJd, epochUtcJd: requestEpochUtcJd, bodies: params.bodies, requestedIds: requested, referenceIds: params.referenceIds, signal: controller.signal, publish: next => {
      if (!gate.current!.isCurrent(request)) return
      setSnapshot(next)
      setLoading(false)
    }}).catch((reason: unknown) => {
      if (!gate.current!.isCurrent(request)) return
      setSnapshot({ frames: new Map(), publishedEpochUtcJd: NaN })
      setError(reason instanceof Error ? reason.message : String(reason))
      setLoading(false)
    })
    return () => gate.current!.cancel(request)
  }, [base, requestKey, params.bodies, params.referenceIds, requested, isPlaying, params.seekRevision])

  return { configured: PRODUCT_PROFILE === 'full' && base !== null, frames: snapshot.frames, error, loading, publishedEpochUtcJd: Number.isFinite(snapshot.publishedEpochUtcJd) ? snapshot.publishedEpochUtcJd : null }
}
