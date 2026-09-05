import { useEffect, useMemo, useRef, useState } from 'react'
import { utcJulianDayToTdb } from '../engine/ephemeris/timeScales'
import { PRODUCT_PROFILE } from '../lib/productAvailability'
import { backendBodyId } from '../lib/currentStateIdentity'
import { assembleStateTiles, buildBackendFrame, chunkStatePlanIds, StateTileSnapshot, digestStateTileRequestIds, fetchStateTiles, readStateTileJson, validateStateTileManifest, validateStateTilePlan, type StateTile, type StateTileManifest, type StateTilePlan } from '../lib/stateTiles'
import type { BackendFrame } from '../lib/backendFrames'
import type { BodyId, CelestialBody } from '../types'

type FetchLike = typeof fetch
export const STATE_TILE_PLAYING_SAMPLE_MS = 500
export type LatestOnlyRequest = { generation: number; controller: AbortController }

export function createLatestOnlyGate() {
  let generation = 0; let active: LatestOnlyRequest | undefined
  return { begin(): LatestOnlyRequest { active?.controller.abort(); const request = { generation: ++generation, controller: new AbortController() }; active = request; return request }, isCurrent(request: LatestOnlyRequest) { return active === request && generation === request.generation && !request.controller.signal.aborted }, cancel(request: LatestOnlyRequest) { request.controller.abort(); if (active === request) active = undefined } }
}

export function stateTileRequestToken(params: { isPlaying: boolean; sample: number; epochUtcJd: number; seekRevision: number }) { return params.isPlaying ? `play:${params.sample}` : `seek:${params.seekRevision}:${params.epochUtcJd}` }
export function sampleStateTileEpoch(epochUtcJd: number, isPlaying: boolean) { if (isPlaying) return epochUtcJd; return epochUtcJd }
export function shouldStartStateTileSample(params: { isPlaying: boolean; requestActive: boolean; latestSample: number; requestedSample: number }) { return params.isPlaying && !params.requestActive && params.latestSample > params.requestedSample }

function apiBase() { const configured = import.meta.env.VITE_SOLAR_API_BASE_URL; return typeof configured === 'string' && configured.trim() ? configured.trim().replace(/\/+$/, '') : null }
export async function fetchStateTilePlan(params: { base: string; bodyIds: string[]; epochTdbJd: number; signal: AbortSignal; fetcher?: FetchLike; manifest?: StateTileManifest }): Promise<{ manifest: StateTileManifest; plan: StateTilePlan }> {
  const fetcher = params.fetcher ?? fetch
  const manifest = params.manifest ?? validateStateTileManifest(await readStateTileJson(await fetcher(`${params.base}/v1/catalog/manifest`, { signal: params.signal }), 'State catalog manifest'))
  const request = { ids: [...params.bodyIds], epochJd: params.epochTdbJd, frame: 'ECLIPJ2000' as const, timeScale: 'TDB' as const, fieldMask: ['position', 'velocity'], precision: 'exact' as const }
  const response = await fetcher(`${params.base}/v1/state/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: params.signal })
  const plan = validateStateTilePlan(await readStateTileJson(response, 'State tile plan'), manifest, params.epochTdbJd, params.bodyIds, await digestStateTileRequestIds(params.bodyIds))
  return { manifest, plan }
}

export async function loadStateTileFrames(params: { base: string; bodyIds: string[]; epochTdbJd: number; epochUtcJd?: number; bodies: CelestialBody[]; requestedIds: Map<BodyId, string>; referenceIds: BodyId[]; signal: AbortSignal; fetcher?: FetchLike }) {
  const fetcher = params.fetcher ?? fetch
  const manifestResponse = await fetcher(`${params.base}/v1/catalog/manifest`, { signal: params.signal }); const manifest = validateStateTileManifest(await readStateTileJson(manifestResponse, 'State catalog manifest'))
  const plans: StateTilePlan[] = []
  const tiles: StateTile[] = []
  for (const bodyIds of chunkStatePlanIds(params.bodyIds)) {
    const { plan } = await fetchStateTilePlan({ ...params, bodyIds, manifest })
    if (plan.catalogManifestSha256 !== manifest.catalogManifestSha256) throw new Error('State tile manifest mismatch')
    plans.push(plan)
    const planTiles = assembleStateTiles(await fetchStateTiles({ base: params.base, plan, signal: params.signal, fetcher: params.fetcher }), plan)
    for (const tile of planTiles) tiles.push(tile)
  }
  const frames = new Map<BodyId, BackendFrame>()
  const evidence = new StateTileSnapshot(tiles, params.requestedIds)
  for (const referenceId of params.referenceIds) frames.set(referenceId, buildBackendFrame({ bodies: params.bodies, referenceId, evidence }))
  return { manifest, plans, frames, epochUtcJd: params.epochUtcJd ?? NaN }
}

export type StateTileFrameSnapshot = { frames: ReadonlyMap<BodyId, BackendFrame>; publishedEpochUtcJd: number }
export async function loadAndPublishStateTileFrames(params: Parameters<typeof loadStateTileFrames>[0] & { epochUtcJd?: number; publish: (snapshot: StateTileFrameSnapshot) => void }) { const { publish, ...loadParams } = params; const loaded = await loadStateTileFrames({ ...loadParams, epochUtcJd: params.epochUtcJd ?? NaN }); publish({ frames: loaded.frames, publishedEpochUtcJd: loaded.epochUtcJd }); return loaded }

export function useStateTiles(params: { bodies: CelestialBody[]; resolutionBodies: CelestialBody[]; referenceIds: BodyId[]; epochUtcJd: number; isPlaying?: boolean; seekRevision?: number }) {
  const [snapshot, setSnapshot] = useState<StateTileFrameSnapshot>({ frames: new Map(), publishedEpochUtcJd: NaN }); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [playingSample, setPlayingSample] = useState(0)
  const gate = useRef<ReturnType<typeof createLatestOnlyGate> | null>(null); if (gate.current == null) gate.current = createLatestOnlyGate(); const activeRequestRef = useRef<LatestOnlyRequest | null>(null); const playingSampleRef = useRef(playingSample); const latestEpochRef = useRef(params.epochUtcJd)
  const base = apiBase(); const requested = useMemo(() => { const bodyById = new Map(params.resolutionBodies.map(body => [body.id, body])); const result = new Map<BodyId, string>(); const add = (id: BodyId) => { const body = bodyById.get(id); if (body) result.set(id, backendBodyId(body)) }; params.bodies.forEach(body => add(body.id)); params.referenceIds.forEach(add); return result }, [params.bodies, params.referenceIds, params.resolutionBodies])
  const latestParamsRef = useRef({ bodies: params.bodies, referenceIds: params.referenceIds, requested }); const isPlaying = params.isPlaying === true
  useEffect(() => { latestEpochRef.current = params.epochUtcJd }, [params.epochUtcJd]); useEffect(() => { latestParamsRef.current = { bodies: params.bodies, referenceIds: params.referenceIds, requested } }, [params.bodies, params.referenceIds, params.resolutionBodies, requested]); useEffect(() => { playingSampleRef.current = playingSample }, [playingSample])
  useEffect(() => { if (!isPlaying) return undefined; const timer = window.setInterval(() => { if (activeRequestRef.current) { playingSampleRef.current += 1; return } setPlayingSample(value => { const next = value + 1; playingSampleRef.current = next; return next }) }, STATE_TILE_PLAYING_SAMPLE_MS); return () => window.clearInterval(timer) }, [isPlaying])
  const requestToken = stateTileRequestToken({ isPlaying, sample: playingSample, epochUtcJd: params.epochUtcJd, seekRevision: params.seekRevision ?? 0 }); const requestKey = `${base ?? 'none'}|${requestToken}|refs:${params.referenceIds.join(',')}|bodies:${[...requested].map(([id, backend]) => `${id}:${backend}`).join(',')}`
  useEffect(() => { const request = gate.current!.begin(); activeRequestRef.current = request; const controller = request.controller; const latest = latestParamsRef.current
    if (PRODUCT_PROFILE === 'preview' || !base || latest.requested.size === 0) { queueMicrotask(() => { if (!gate.current!.isCurrent(request)) return; setSnapshot({ frames: new Map(), publishedEpochUtcJd: NaN }); setError(null); setLoading(false); activeRequestRef.current = null }); return () => { if (activeRequestRef.current === request) activeRequestRef.current = null; gate.current!.cancel(request) } }
    queueMicrotask(() => { if (gate.current!.isCurrent(request)) { setLoading(true); setError(null) } }); const epochUtcJd = sampleStateTileEpoch(latestEpochRef.current, isPlaying); const epochTdbJd = utcJulianDayToTdb(epochUtcJd); const requestSample = playingSampleRef.current
    void loadAndPublishStateTileFrames({ base, bodyIds: [...latest.requested.values()], epochTdbJd, epochUtcJd, bodies: latest.bodies, requestedIds: latest.requested, referenceIds: latest.referenceIds, signal: controller.signal, publish: next => { if (!gate.current!.isCurrent(request)) return; setSnapshot(next); setLoading(false); activeRequestRef.current = null; if (shouldStartStateTileSample({ isPlaying, requestActive: false, latestSample: playingSampleRef.current, requestedSample: requestSample })) setPlayingSample(value => Math.max(value, playingSampleRef.current)) } }).catch((reason: unknown) => { if (!gate.current!.isCurrent(request)) return; activeRequestRef.current = null; setSnapshot({ frames: new Map(), publishedEpochUtcJd: NaN }); setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false) })
    return () => { if (activeRequestRef.current === request) activeRequestRef.current = null; gate.current!.cancel(request) }
  }, [base, requestKey, isPlaying, params.seekRevision])
  return { configured: PRODUCT_PROFILE === 'full' && base !== null, frames: snapshot.frames, error, loading, publishedEpochUtcJd: Number.isFinite(snapshot.publishedEpochUtcJd) ? snapshot.publishedEpochUtcJd : null }
}
