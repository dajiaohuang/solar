import { useEffect, useMemo, useRef, useState } from 'react'
import { utcJulianDayToTdb } from '../engine/ephemeris/timeScales'
import { PRODUCT_PROFILE } from '../lib/productAvailability'
import { backendBodyId } from '../lib/currentStateIdentity'
import { framesFromCurrentStateObservation } from '../lib/currentStateObservation'
import { createCurrentStateWorkerClient } from '../lib/currentStateWorkerClient'
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
export type StateTileFrameSnapshot = { frames: ReadonlyMap<BodyId, BackendFrame>; publishedEpochUtcJd: number }

export function useStateTiles(params: { bodies: CelestialBody[]; resolutionBodies: CelestialBody[]; referenceIds: BodyId[]; epochUtcJd: number; isPlaying?: boolean; seekRevision?: number }) {
  const [snapshot, setSnapshot] = useState<StateTileFrameSnapshot>({ frames: new Map(), publishedEpochUtcJd: NaN }); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [playingSample, setPlayingSample] = useState(0)
  const gate = useRef<ReturnType<typeof createLatestOnlyGate> | null>(null); if (gate.current == null) gate.current = createLatestOnlyGate(); const activeRequestRef = useRef<LatestOnlyRequest | null>(null); const playingSampleRef = useRef(playingSample); const latestEpochRef = useRef(params.epochUtcJd)
  const clientRef = useRef<ReturnType<typeof createCurrentStateWorkerClient> | null>(null)
  const base = apiBase(); const requested = useMemo(() => { const bodyById = new Map(params.resolutionBodies.map(body => [body.id, body])); const result = new Map<BodyId, string>(); const add = (id: BodyId) => { const body = bodyById.get(id); if (body) result.set(id, backendBodyId(body)) }; params.bodies.forEach(body => add(body.id)); params.referenceIds.forEach(add); return result }, [params.bodies, params.referenceIds, params.resolutionBodies])
  const latestParamsRef = useRef({ bodies: params.bodies, referenceIds: params.referenceIds, requested }); const isPlaying = params.isPlaying === true
  useEffect(() => { latestEpochRef.current = params.epochUtcJd }, [params.epochUtcJd]); useEffect(() => { latestParamsRef.current = { bodies: params.bodies, referenceIds: params.referenceIds, requested } }, [params.bodies, params.referenceIds, params.resolutionBodies, requested]); useEffect(() => { playingSampleRef.current = playingSample }, [playingSample])
  useEffect(() => { if (!isPlaying) return undefined; const timer = window.setInterval(() => { if (activeRequestRef.current) { playingSampleRef.current += 1; return } setPlayingSample(value => { const next = value + 1; playingSampleRef.current = next; return next }) }, STATE_TILE_PLAYING_SAMPLE_MS); return () => window.clearInterval(timer) }, [isPlaying])
  const requestToken = stateTileRequestToken({ isPlaying, sample: playingSample, epochUtcJd: params.epochUtcJd, seekRevision: params.seekRevision ?? 0 }); const requestKey = `${base ?? 'none'}|${requestToken}|refs:${params.referenceIds.join(',')}|bodies:${[...requested].map(([id, backend]) => `${id}:${backend}`).join(',')}`
  useEffect(() => { const request = gate.current!.begin(); activeRequestRef.current = request; const controller = request.controller; const latest = latestParamsRef.current
    if (PRODUCT_PROFILE === 'preview' || !base || latest.requested.size === 0) { clientRef.current?.dispose(); clientRef.current = null; queueMicrotask(() => { if (!gate.current!.isCurrent(request)) return; setSnapshot({ frames: new Map(), publishedEpochUtcJd: NaN }); setError(null); setLoading(false); activeRequestRef.current = null }); return () => { if (activeRequestRef.current === request) activeRequestRef.current = null; gate.current!.cancel(request) } }
    queueMicrotask(() => { if (gate.current!.isCurrent(request)) { setLoading(true); setError(null) } }); const epochUtcJd = sampleStateTileEpoch(latestEpochRef.current, isPlaying); const epochTdbJd = utcJulianDayToTdb(epochUtcJd); const requestSample = playingSampleRef.current
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      if (!clientRef.current || clientRef.current.closed) clientRef.current = createCurrentStateWorkerClient()
      return clientRef.current.load({ base, epochTdbJd, epochUtcJd, selectedIds: latest.bodies.map(body => body.id), requestedIds: latest.requested, referenceIds: latest.referenceIds }, controller.signal)
    }).then(value => {
      if (!gate.current!.isCurrent(request)) return
      const frames = framesFromCurrentStateObservation(value, latest.bodies, latest.referenceIds)
      setSnapshot({ frames, publishedEpochUtcJd: value.epochUtcJd }); setLoading(false); activeRequestRef.current = null
      if (shouldStartStateTileSample({ isPlaying, requestActive: false, latestSample: playingSampleRef.current, requestedSample: requestSample })) setPlayingSample(value => Math.max(value, playingSampleRef.current))
    }).catch((reason: unknown) => { if (!gate.current!.isCurrent(request)) return; activeRequestRef.current = null; setSnapshot({ frames: new Map(), publishedEpochUtcJd: NaN }); setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false) })
    return () => { if (activeRequestRef.current === request) activeRequestRef.current = null; gate.current!.cancel(request) }
  }, [base, requestKey, isPlaying, params.seekRevision])
  useEffect(() => () => { clientRef.current?.dispose(); clientRef.current = null }, [])
  return { configured: PRODUCT_PROFILE === 'full' && base !== null, frames: snapshot.frames, error, loading, publishedEpochUtcJd: Number.isFinite(snapshot.publishedEpochUtcJd) ? snapshot.publishedEpochUtcJd : null }
}
