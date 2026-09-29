import { chunkStatePlanIds, fetchStateTiles, frameFromStateTileProjection, projectStateTileFrame, readStateTileJson, StateTileSnapshot, validateStateTileManifest,
  MAX_STATE_PLAN_BODIES, STATE_TILE_CONCURRENCY, type StateTile, type StateTileFrameProjection, type StateTileManifest, type StateTileSnapshotTransfer } from './stateTiles'
import { fetchStateTilePlan } from './stateTileClient'
import { createStateTileAdmissionPool } from './stateTileAdmission'
import type { BackendFrame } from './backendFrames'
import type { BodyId, CelestialBody } from '../types'
import { requireSourcePin, type SourceScenePin } from './sourceScene'
import { ADVERTISED_QUEUE_RETRY, fetchRetryableResponse } from './retryableHttpResponse'

export type CurrentStateObservationRequest = {
  base: string
  selectedIds: BodyId[]
  /** Selected identities that fit in the reference-first initial plan. */
  initialSelectedIds?: BodyId[]
  /** Stream an initial frame only when no complete frame exists for this identity. */
  publishInitialPartial?: boolean
  requestedIds: Map<BodyId, string>
  referenceIds: BodyId[]
  epochTdbJd: number
  epochUtcJd: number
  sourcePin?: SourceScenePin
}

/** Internal worker result. Original HTTP bytes are verified before this
 * column-packed snapshot is constructed; this is not a second public protocol. */
export type CurrentStateObservation = {
  manifest: StateTileManifest
  planRecordCounts: number[]
  snapshot: StateTileSnapshotTransfer
  projections: StateTileFrameProjection[]
  epochTdbJd: number
  epochUtcJd: number
}

export type CurrentStateObservationPartial = {
  selectedIds: BodyId[]
  observation: CurrentStateObservation
}

// Pipeline plan preparation without increasing the two-tile transfer permit.
const STATE_PLAN_CONCURRENCY = 2

export async function loadCurrentStateObservation(params: CurrentStateObservationRequest & {
  signal: AbortSignal
  fetcher?: typeof fetch
  acquireTile?: import('./stateTileAdmission').AcquireStateTile
  onInitialPartial?: (partial: CurrentStateObservationPartial) => void
}): Promise<CurrentStateObservation> {
  params.signal.throwIfAborted()
  // Keep every parallel plan, ID binding and final projection on the same
  // selection/source/epoch snapshot across network and admission awaits.
  params = { ...params, selectedIds: [...params.selectedIds], initialSelectedIds: params.initialSelectedIds ? [...params.initialSelectedIds] : undefined, referenceIds: [...params.referenceIds],
    requestedIds: new Map(params.requestedIds), sourcePin: params.sourcePin ? { ...params.sourcePin } : undefined }
  if (!Number.isFinite(params.epochTdbJd) || !Number.isFinite(params.epochUtcJd) || !params.requestedIds.size) throw new Error('Invalid current-state observation request')
  const fetcher = params.fetcher ?? fetch
  const manifest = validateStateTileManifest(await readStateTileJson(await fetchRetryableResponse(fetcher, `${params.base}/v1/catalog/manifest`, { signal: params.signal }, params.signal, ADVERTISED_QUEUE_RETRY), 'State catalog manifest', undefined, params.signal))
  if (params.sourcePin) requireSourcePin(params.sourcePin, params.base, manifest)
  const chunks = chunkStatePlanIds([...params.requestedIds.values()], Math.min(MAX_STATE_PLAN_BODIES, manifest.maxPlanIds), manifest.maxPlanBytes, params.epochTdbJd)
  const firstPlanIds = new Set(chunks[0] ?? [])
  const initialSelectedIds = (params.initialSelectedIds ?? (params.publishInitialPartial === true ? params.selectedIds.filter(bodyId => {
    const backendId = params.requestedIds.get(bodyId)
    return backendId !== undefined && firstPlanIds.has(backendId.trim())
  }) : [])).slice(0, MAX_STATE_PLAN_BODIES)
  const initialReferencesReady = params.referenceIds.every(referenceId => {
    const backendId = params.requestedIds.get(referenceId)
    return backendId !== undefined && firstPlanIds.has(backendId.trim())
  })
  const initialSelectionReady = initialSelectedIds.length > 0 && initialSelectedIds.every(bodyId => {
    const backendId = params.requestedIds.get(bodyId)
    return backendId !== undefined && firstPlanIds.has(backendId.trim())
  })
  const canPublishInitialPartial = params.publishInitialPartial === true && chunks.length > 1 && Boolean(params.onInitialPartial)
    && initialReferencesReady && initialSelectionReady
  const acquireTile = params.acquireTile ?? createStateTileAdmissionPool(STATE_TILE_CONCURRENCY).acquire
  const results: Array<{ recordCount: number; tiles: StateTile[] } | undefined> = new Array(chunks.length)
  const planController = new AbortController()
  const cancelPlans = () => planController.abort(params.signal.reason)
  params.signal.addEventListener('abort', cancelPlans, { once: true })
  if (params.signal.aborted) cancelPlans()
  let cursor = 0, failed = false, firstError: unknown, initialPublished = false
  const loadNextPlan = async () => {
    while (!failed && !planController.signal.aborted) {
      const index = cursor++
      const bodyIds = chunks[index]
      if (!bodyIds) return
      try {
        const { plan } = await fetchStateTilePlan({ ...params, bodyIds, manifest, signal: planController.signal })
        const planTiles = await fetchStateTiles({ base: params.base, plan, signal: planController.signal, fetcher, acquireTile })
        planController.signal.throwIfAborted()
        results[index] = { recordCount: plan.recordCount, tiles: planTiles }
        if (canPublishInitialPartial && index === 0 && !initialPublished && params.onInitialPartial) {
          const partialRequestedIds = new Map<BodyId, string>()
          for (const bodyId of params.referenceIds) {
            const backendId = params.requestedIds.get(bodyId)
            if (backendId && firstPlanIds.has(backendId.trim())) partialRequestedIds.set(bodyId, backendId.trim())
          }
          for (const bodyId of initialSelectedIds) {
            const backendId = params.requestedIds.get(bodyId)
            if (backendId && firstPlanIds.has(backendId.trim())) partialRequestedIds.set(bodyId, backendId.trim())
          }
          const snapshot = new StateTileSnapshot(planTiles, partialRequestedIds)
          const projections = params.referenceIds.map(referenceId => projectStateTileFrame({ bodyIds: initialSelectedIds, referenceId, evidence: snapshot }))
          params.signal.throwIfAborted()
          params.onInitialPartial({ selectedIds: initialSelectedIds, observation: { manifest, planRecordCounts: [plan.recordCount], snapshot: snapshot.transfer(),
            projections, epochTdbJd: params.epochTdbJd, epochUtcJd: params.epochUtcJd } })
          initialPublished = true
          if (failed) planController.abort(firstError)
        }
      } catch (error) {
        if (!failed) { failed = true; firstError = error }
        if (index === 0 || initialPublished || !canPublishInitialPartial) planController.abort(firstError)
      }
    }
  }
  try {
    // At most two plan requests are prepared in parallel. Tile transfers still
    // pass through the page-wide or same-sized standalone admission pool.
    await Promise.all(Array.from({ length: Math.min(STATE_PLAN_CONCURRENCY, chunks.length) }, () => loadNextPlan()))
    params.signal.throwIfAborted()
    if (failed) throw firstError
  } finally {
    params.signal.removeEventListener('abort', cancelPlans)
  }
  const tiles: StateTile[] = [], planRecordCounts: number[] = []
  for (const result of results) {
    if (!result) throw new Error('Current-state plan batch is incomplete')
    planRecordCounts.push(result.recordCount)
    for (const tile of result.tiles) tiles.push(tile)
  }
  const snapshot = new StateTileSnapshot(tiles, params.requestedIds)
  const projections = params.referenceIds.map(referenceId => projectStateTileFrame({ bodyIds: params.selectedIds, referenceId, evidence: snapshot }))
  params.signal.throwIfAborted()
  return { manifest, planRecordCounts, snapshot: snapshot.transfer(), projections, epochTdbJd: params.epochTdbJd, epochUtcJd: params.epochUtcJd }
}

/** Transfer ownership of every numeric buffer exactly once. No copy, JSON
 * number conversion, metadata row expansion or inactive renderer buffer. */
export function currentStateObservationTransfers(value: CurrentStateObservation): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  const add = (view: ArrayBufferView) => buffers.add(view.buffer as ArrayBuffer)
  add(value.snapshot.tileIndexes); add(value.snapshot.rowIndexes)
  for (const tile of value.snapshot.tiles) {
    add(tile.states); add(tile.exactBitmap); add(tile.approximateBitmap); add(tile.missingBitmap)
    add(tile.metadata.stringIndexes); add(tile.metadata.numbers); add(tile.metadata.flags)
  }
  for (const projection of value.projections) {
    add(projection.bodyOrdinals); add(projection.stateOrdinals); add(projection.referenceAu)
  }
  return [...buffers]
}

/** UI-side adoption is per tile/reference, not a reconstruction of every
 * source row or relative position. Both references retain the same snapshot. */
export function framesFromCurrentStateObservation(value: CurrentStateObservation, bodies: CelestialBody[], referenceIds: readonly BodyId[]): Map<BodyId, BackendFrame> {
  if (value.projections.length !== referenceIds.length || value.projections.some((projection, index) => projection.referenceId !== referenceIds[index])) throw new Error('Current-state worker reference mismatch')
  const evidence = StateTileSnapshot.restoreTransferred(value.snapshot)
  if (evidence.catalogManifestSha256 !== value.manifest.catalogManifestSha256 || evidence.inventoryManifestSha256 !== value.manifest.inventoryManifestSha256 || evidence.epochJd !== value.epochTdbJd) throw new Error('Current-state worker source mismatch')
  const frames = new Map<BodyId, BackendFrame>()
  for (const projection of value.projections) frames.set(projection.referenceId, frameFromStateTileProjection({ bodies, evidence, projection }))
  return frames
}
