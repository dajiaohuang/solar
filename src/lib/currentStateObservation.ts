import { chunkStatePlanIds, fetchStateTiles, frameFromStateTileProjection, projectStateTileFrame, readStateTileJson, StateTileSnapshot, validateStateTileManifest,
  type StateTile, type StateTileFrameProjection, type StateTileManifest, type StateTileSnapshotTransfer } from './stateTiles'
import { fetchStateTilePlan } from './stateTileClient'
import type { BackendFrame } from './backendFrames'
import type { BodyId, CelestialBody } from '../types'

export type CurrentStateObservationRequest = {
  base: string
  selectedIds: BodyId[]
  requestedIds: Map<BodyId, string>
  referenceIds: BodyId[]
  epochTdbJd: number
  epochUtcJd: number
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

export async function loadCurrentStateObservation(params: CurrentStateObservationRequest & { signal: AbortSignal; fetcher?: typeof fetch; acquireTile?: import('./stateTileAdmission').AcquireStateTile }): Promise<CurrentStateObservation> {
  params.signal.throwIfAborted()
  if (!Number.isFinite(params.epochTdbJd) || !Number.isFinite(params.epochUtcJd) || !params.requestedIds.size) throw new Error('Invalid current-state observation request')
  const fetcher = params.fetcher ?? fetch
  const manifest = validateStateTileManifest(await readStateTileJson(await fetcher(`${params.base}/v1/catalog/manifest`, { signal: params.signal }), 'State catalog manifest'))
  const tiles: StateTile[] = [], planRecordCounts: number[] = []
  // Plans are serial; each plan admits at most two tile transfers. No partial
  // selection is published if a later plan fails or cancellation is observed.
  for (const bodyIds of chunkStatePlanIds([...params.requestedIds.values()])) {
    params.signal.throwIfAborted()
    const { plan } = await fetchStateTilePlan({ ...params, bodyIds, manifest })
    const planTiles = await fetchStateTiles({ base: params.base, plan, signal: params.signal, fetcher, acquireTile: params.acquireTile })
    params.signal.throwIfAborted()
    planRecordCounts.push(plan.recordCount)
    for (const tile of planTiles) tiles.push(tile)
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
