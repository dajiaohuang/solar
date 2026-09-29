import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { utcJulianDayToTdb } from '../engine/ephemeris/timeScales'
import { PRODUCT_PROFILE } from '../lib/productAvailability'
import { backendBodyId } from '../lib/currentStateIdentity'
import { framesFromCurrentStateObservation } from '../lib/currentStateObservation'
import { MAX_STATE_PLAN_BODIES } from '../lib/stateTiles'
import { createCurrentStateWorkerClient } from '../lib/currentStateWorkerClient'
import type { SourceScenePin } from '../lib/sourceScene'
import type { BackendFrame } from '../lib/backendFrames'
import type { BodyId, CelestialBody } from '../types'

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
export type StateTileFrameSnapshot = { frames: ReadonlyMap<BodyId, BackendFrame>; publishedEpochUtcJd: number; identityKey?: string; complete?: boolean }

export function useStateTiles(params: { bodies: CelestialBody[]; resolutionBodies: CelestialBody[]; referenceIds: BodyId[]; epochUtcJd: number; isPlaying?: boolean; seekRevision?: number; includeSunDependency?: boolean; sourcePin?: SourceScenePin }) {
  const [snapshot, setSnapshot] = useState<StateTileFrameSnapshot>({ frames: new Map(), publishedEpochUtcJd: NaN, complete: false }); const snapshotRef = useRef(snapshot); const publishSnapshot = useCallback((value: StateTileFrameSnapshot) => { snapshotRef.current = value; setSnapshot(value) }, []); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [playingSample, setPlayingSample] = useState(0)
  const gate = useRef<ReturnType<typeof createLatestOnlyGate> | null>(null); if (gate.current == null) gate.current = createLatestOnlyGate(); const activeRequestRef = useRef<LatestOnlyRequest | null>(null); const playingSampleRef = useRef(playingSample); const latestEpochRef = useRef(params.epochUtcJd)
  const clientRef = useRef<ReturnType<typeof createCurrentStateWorkerClient> | null>(null)
  const base = apiBase(); const requestSelection = useMemo(() => {
    const bodyById = new Map(params.resolutionBodies.map(body => [body.id, body]))
    const requested = new Map<BodyId, string>()
    const add = (id: BodyId) => { const body = bodyById.get(id); if (body) requested.set(id, backendBodyId(body)) }
    // Only the heliocentric catalog overlay needs this hidden SSB transform dependency.
    if (params.includeSunDependency) add('sun')
    params.referenceIds.forEach(add)
    const firstPlanBackends = new Set([...requested.values()].map(id => id.trim()).filter(Boolean))
    const initialSelectedIds: BodyId[] = [], initialSelectedBodies: CelestialBody[] = []
    for (const body of params.bodies) {
      add(body.id)
      const backendId = requested.get(body.id)?.trim()
      if (!backendId) continue
      if (!firstPlanBackends.has(backendId)) {
        if (firstPlanBackends.size >= MAX_STATE_PLAN_BODIES) continue
        firstPlanBackends.add(backendId)
      }
      if (initialSelectedIds.length >= MAX_STATE_PLAN_BODIES) continue
      initialSelectedIds.push(body.id); initialSelectedBodies.push(body)
    }
    return { requested, initialSelectedIds, initialSelectedBodies }
  }, [params.bodies, params.referenceIds, params.resolutionBodies, params.includeSunDependency])
  const { requested, initialSelectedIds, initialSelectedBodies } = requestSelection
  const latestParamsRef = useRef({ bodies: params.bodies, referenceIds: params.referenceIds, requested, initialSelectedIds, initialSelectedBodies, sourcePin: params.sourcePin }); const isPlaying = params.isPlaying === true
  useEffect(() => { latestEpochRef.current = params.epochUtcJd }, [params.epochUtcJd]); useEffect(() => { latestParamsRef.current = { bodies: params.bodies, referenceIds: params.referenceIds, requested, initialSelectedIds, initialSelectedBodies, sourcePin: params.sourcePin } }, [params.bodies, params.referenceIds, params.resolutionBodies, requestSelection, params.sourcePin]); useEffect(() => { playingSampleRef.current = playingSample }, [playingSample])
  useEffect(() => { if (!isPlaying) return undefined; const timer = window.setInterval(() => { if (activeRequestRef.current) { playingSampleRef.current += 1; return } setPlayingSample(value => { const next = value + 1; playingSampleRef.current = next; return next }) }, STATE_TILE_PLAYING_SAMPLE_MS); return () => window.clearInterval(timer) }, [isPlaying])
  const identityKey = JSON.stringify([base, params.referenceIds, [...requested], params.sourcePin ?? null])
  const requestToken = stateTileRequestToken({ isPlaying, sample: playingSample, epochUtcJd: params.epochUtcJd, seekRevision: params.seekRevision ?? 0 }); const requestKey = `${base ?? 'none'}|${requestToken}|refs:${params.referenceIds.join(',')}|bodies:${[...requested].map(([id, backend]) => `${id}:${backend}`).join(',')}|source:${params.sourcePin ? `${params.sourcePin.catalogVersion}:${params.sourcePin.catalogManifestSha256}:${params.sourcePin.inventoryManifestSha256}:${params.sourcePin.base}` : 'none'}`
  useEffect(() => { const request = gate.current!.begin(); activeRequestRef.current = request; const controller = request.controller; const latest = latestParamsRef.current
    if (PRODUCT_PROFILE === 'preview' || !base || latest.requested.size === 0) { clientRef.current?.dispose(); clientRef.current = null; queueMicrotask(() => { if (!gate.current!.isCurrent(request)) return; publishSnapshot({ frames: new Map(), publishedEpochUtcJd: NaN, complete: false }); setError(null); setLoading(false); activeRequestRef.current = null }); return () => { if (activeRequestRef.current === request) activeRequestRef.current = null; gate.current!.cancel(request) } }
    queueMicrotask(() => { if (gate.current!.isCurrent(request)) { setLoading(true); setError(null) } }); const epochUtcJd = sampleStateTileEpoch(latestEpochRef.current, isPlaying); const epochTdbJd = utcJulianDayToTdb(epochUtcJd); const requestSample = playingSampleRef.current
    const publishInitialPartial = snapshotRef.current.identityKey !== identityKey || snapshotRef.current.complete !== true
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      if (!clientRef.current || clientRef.current.closed) clientRef.current = createCurrentStateWorkerClient()
      return clientRef.current.load({ base, epochTdbJd, epochUtcJd, selectedIds: latest.bodies.map(body => body.id), initialSelectedIds: latest.initialSelectedIds, publishInitialPartial,
        requestedIds: latest.requested, referenceIds: latest.referenceIds, sourcePin: latest.sourcePin }, controller.signal, partial => {
        if (!gate.current!.isCurrent(request)) return
        if (partial.selectedIds.length !== latest.initialSelectedBodies.length
          || partial.selectedIds.some((id, index) => id !== latest.initialSelectedBodies[index]?.id)) throw new Error('Current-state worker partial selection mismatch')
        const frames = framesFromCurrentStateObservation(partial.observation, latest.initialSelectedBodies, latest.referenceIds)
        publishSnapshot({ frames, publishedEpochUtcJd: partial.observation.epochUtcJd, identityKey, complete: false })
      })
    }).then(value => {
      if (!gate.current!.isCurrent(request)) return
      const frames = framesFromCurrentStateObservation(value, latest.bodies, latest.referenceIds)
      publishSnapshot({ frames, publishedEpochUtcJd: value.epochUtcJd, identityKey, complete: true }); setLoading(false); activeRequestRef.current = null
      if (shouldStartStateTileSample({ isPlaying, requestActive: false, latestSample: playingSampleRef.current, requestedSample: requestSample })) setPlayingSample(value => Math.max(value, playingSampleRef.current))
    }).catch((reason: unknown) => { if (!gate.current!.isCurrent(request)) return; activeRequestRef.current = null; setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false) })
    return () => { if (activeRequestRef.current === request) activeRequestRef.current = null; gate.current!.cancel(request) }
  }, [base, requestKey, identityKey, isPlaying, params.seekRevision, publishSnapshot])
  useEffect(() => () => { clientRef.current?.dispose(); clientRef.current = null }, [])
  return { configured: PRODUCT_PROFILE === 'full' && base !== null, frames: snapshot.identityKey === identityKey ? snapshot.frames : new Map<BodyId, BackendFrame>(), error, loading, publishedEpochUtcJd: snapshot.identityKey === identityKey && Number.isFinite(snapshot.publishedEpochUtcJd) ? snapshot.publishedEpochUtcJd : null }
}
