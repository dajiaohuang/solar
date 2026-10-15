import { utcJulianDayToTdb } from '../engine/ephemeris/timeScales'
import { backendBodyId } from './currentStateIdentity'
import { fetchStateWindow } from './stateWindowClient'
import { buildBackendFrame, StateTileSnapshot, type StateTileMetadata } from './stateTiles'
import { createTrajectoryAccumulator } from './trajectorySamples'
import type { CelestialBody, PackedTrajectoryData } from '../types'

export const TRAJECTORY_AUDIT_TEXT_BYTES = 8 * 1024 * 1024
export const TRAJECTORY_DEADLINE_MS = 120_000

export type BackendTrajectoryAudit = {
  kind: 'backend-state-tiles'
  precision: 'exact-samples'
  frame: 'ECLIPJ2000'
  timeScale: 'TDB'
  sourceOriginId: 'naif:0'
  coordinateUnit: 'AU'
  referenceId: string
  startUtcJd: number
  endUtcJd: number
  catalogManifestSha256: string
  inventoryManifestSha256?: string
  bodyIds: string[]
  backendIds: string[]
  epochsTdbJd: Float64Array
  /** Epoch-major references into the interned provenance dictionary. Includes
   * the reference body and missing samples, not just the visible trails. */
  sourceOrdinals: Uint32Array
  sources: StateTileMetadata[]
  planHashes: string[]
  tiles: { epochIndex: number; sequence: number; ordinalStart: number; recordCount: number; payloadSha256: string }[]
  gaps: { bodyId: string; epochIndex: number; reason: string }[]
  sourceTransitions?: { bodyId: string; epochIndex: number; previousSourceOrdinal: number; sourceOrdinal: number }[]
}

export type BackendTrajectoryResult = { packed: PackedTrajectoryData; audit: BackendTrajectoryAudit }

/** Explicit export only; live UI/worker storage remains column-packed. */
export function exportBackendTrajectoryAudit(audit: BackendTrajectoryAudit) {
  return { ...audit, epochsTdbJd: Array.from(audit.epochsTdbJd), sourceOrdinals: Array.from(audit.sourceOrdinals),
    boundary: 'Verified discrete samples only. Connecting lines are display interpolation, not certified continuous ephemerides. Edges are disconnected at detected sampled source/model/center changes; changes between samples or within an unchanged source are not independently certified.' }
}

/** Exact sampled states, not a continuous-orbit accuracy certificate. Only
 * one epoch's verified six-vector tiles is retained while writing the history;
 * the shared tile fetcher admits at most two transfers and retries per tile. */
export async function loadBackendTrajectories(params: {
  base: string
  bodies: CelestialBody[]
  referenceBody: CelestialBody
  centerUtcJd: number
  historyDays: number
  sampleCount: number
  signal: AbortSignal
  expectedCatalogManifestSha256?: string
  expectedInventoryManifestSha256?: string
  fetcher?: typeof fetch
  acquireTile?: import('./stateTileAdmission').AcquireStateTile
  onProgress?: (progress: number) => void
}): Promise<BackendTrajectoryResult> {
  const deadline = performance.now() + TRAJECTORY_DEADLINE_MS
  if (!Number.isFinite(params.centerUtcJd) || !Number.isFinite(params.historyDays) || params.historyDays <= 0 || params.historyDays > 365_250 || params.sampleCount < 2) throw new Error('Invalid backend trajectory window')
  // Validate the detail ceiling before allocating or starting any network I/O.
  const accumulator = createTrajectoryAccumulator(params.bodies, params.sampleCount)
  const requested = new Map(params.bodies.map(body => [body.id, backendBodyId(body)]))
  requested.set(params.referenceBody.id, backendBodyId(params.referenceBody))
  const bodyIds = [...requested.keys()], backendIds = [...requested.values()]
  const uniqueBackendIds = [...new Set(backendIds)]
  const controller = new AbortController()
  const cancel = () => controller.abort(params.signal.reason)
  const check = () => {
    if (performance.now() >= deadline) controller.abort(new Error('Backend trajectory deadline exceeded'))
    controller.signal.throwIfAborted()
  }
  // This opt-in can only lower state requests into the existing trajectory
  // queue, never promote directory/bulk traffic to an interactive priority.
  const fetcher: typeof fetch = (input, init) => {
    const url = String(input)
    return (params.fetcher ?? fetch)(init?.method === 'POST' ? `${url}${url.includes('?') ? '&' : '?'}workload=trajectory` : input, init)
  }
  const audit: BackendTrajectoryAudit = {
    kind: 'backend-state-tiles', precision: 'exact-samples', frame: 'ECLIPJ2000', timeScale: 'TDB', sourceOriginId: 'naif:0', coordinateUnit: 'AU',
    referenceId: params.referenceBody.id, startUtcJd: params.centerUtcJd - params.historyDays, endUtcJd: params.centerUtcJd,
    catalogManifestSha256: '', bodyIds, backendIds, epochsTdbJd: new Float64Array(params.sampleCount),
    sourceOrdinals: new Uint32Array(params.sampleCount * bodyIds.length), sources: [], planHashes: [], tiles: [], gaps: [],
  }
  const sourceIndexes = new Map<string, number>(), gaps = new Set<string>()
  const previousSources = new Map<string, { key: string; ordinal: number }>()
  let auditTextBytes = 0
  const auditEncoder = new TextEncoder()
  const charge = (text: string) => {
    auditTextBytes += auditEncoder.encode(text).byteLength
    if (auditTextBytes > TRAJECTORY_AUDIT_TEXT_BYTES) throw new Error('Backend trajectory provenance budget exceeded')
  }
  // Register external resources only after synchronous allocations succeed.
  params.signal.addEventListener('abort', cancel, { once: true })
  if (params.signal.aborted) cancel()
  const timer = setTimeout(() => controller.abort(new Error('Backend trajectory deadline exceeded')), Math.max(0, deadline-performance.now()))
  try {
    check()
    charge(JSON.stringify({ referenceId: audit.referenceId, bodyIds, backendIds }))
    // Preserve the requested endpoints exactly before UTC-to-TDB conversion;
    // subtracting and re-adding the history span can round the final UTC epoch.
    const epochsTdbJd = Array.from({ length: params.sampleCount }, (_, index) => utcJulianDayToTdb(
      index === 0 ? audit.startUtcJd : index === params.sampleCount-1 ? audit.endUtcJd
        : audit.startUtcJd + index / (params.sampleCount - 1) * params.historyDays))
    check()
    for await (const { epochIndex, manifest, plan, tiles } of fetchStateWindow({
      base: params.base, bodyIds: uniqueBackendIds, epochsTdbJd, signal: controller.signal, fetcher,
      acquireTile: params.acquireTile, expectedCatalogManifestSha256: params.expectedCatalogManifestSha256,
      expectedInventoryManifestSha256: params.expectedInventoryManifestSha256,
    })) {
      check()
      const epochTdbJd = epochsTdbJd[epochIndex]
      if (epochIndex === 0) charge(JSON.stringify({ catalogManifestSha256: manifest.catalogManifestSha256, inventoryManifestSha256: manifest.inventoryManifestSha256 }))
      audit.catalogManifestSha256 = manifest.catalogManifestSha256
      audit.inventoryManifestSha256 = manifest.inventoryManifestSha256
      const snapshot = new StateTileSnapshot(tiles, requested)
      const referenceIndex = snapshot.indexOf(params.referenceBody.id)
      const referenceAvailable = referenceIndex >= 0 && snapshot.statusAt(referenceIndex) === 'exact'
      audit.epochsTdbJd[epochIndex] = epochTdbJd
      charge(plan.planHash)
      audit.planHashes.push(plan.planHash)
      for (const tile of tiles) {
        const entry = { epochIndex, sequence: tile.sequence, ordinalStart: tile.ordinalStart, recordCount: tile.recordCount, payloadSha256: tile.payloadSha256 }
        charge(JSON.stringify(entry)); audit.tiles.push(entry)
      }
      const changedSources = new Set<string>()
      for (let bodyIndex = 0; bodyIndex < bodyIds.length; bodyIndex++) {
        const bodyId = bodyIds[bodyIndex], index = snapshot.indexOf(bodyId)
        if (index < 0) throw new Error('Backend trajectory omitted a requested identity')
        const row = snapshot.rowAt(index)
        // Source IDs, not display aliases, identify the dictionary entries.
        const metadata: StateTileMetadata = { ...row, id: backendIds[bodyIndex] }
        Reflect.deleteProperty(metadata, 'bodyId'); Reflect.deleteProperty(metadata, 'backendId')
        const key = JSON.stringify(metadata)
        let sourceOrdinal = sourceIndexes.get(key)
        if (sourceOrdinal === undefined) {
          charge(key); sourceOrdinal = audit.sources.length
          sourceIndexes.set(key, sourceOrdinal); audit.sources.push(metadata)
        }
        audit.sourceOrdinals[epochIndex * bodyIds.length + bodyIndex] = sourceOrdinal
        // Record validity ranges can change inside one source without a model
        // switch. Compare source/model/center identities, not the whole row.
        const continuityKey = JSON.stringify([metadata.source, metadata.kernelSha256, metadata.datasetVersion,
          metadata.datasetSha256, metadata.model, metadata.centerId, metadata.stateEvidence, metadata.sourceChainSha256])
        const previous = previousSources.get(bodyId)
        if (previous && previous.key !== continuityKey) {
          changedSources.add(bodyId)
          const transition = { bodyId, epochIndex, previousSourceOrdinal: previous.ordinal, sourceOrdinal }
          charge(JSON.stringify(transition)); (audit.sourceTransitions ??= []).push(transition)
        }
        previousSources.set(bodyId, { key: continuityKey, ordinal: sourceOrdinal })
        if (bodyIndex < params.bodies.length && !gaps.has(bodyId) && (!referenceAvailable || snapshot.statusAt(index) !== 'exact')) {
          const reason = referenceAvailable ? snapshot.missingReasonAt(index)
            : `reference-state-unavailable:${referenceIndex >= 0 ? snapshot.missingReasonAt(referenceIndex) : 'not-received'}`
          const gap = { bodyId, epochIndex, reason }
          charge(JSON.stringify(gap)); audit.gaps.push(gap); gaps.add(bodyId)
        }
      }
      for (const body of params.bodies) {
        if (changedSources.has(body.id) || changedSources.has(params.referenceBody.id)) accumulator.breakBeforeNextSample(body.id)
      }
      accumulator.appendCurrent(buildBackendFrame({ bodies: params.bodies, referenceId: params.referenceBody.id, evidence: snapshot }).currentPositions)
      params.onProgress?.((epochIndex + 1) / params.sampleCount)
      // Permit cancellation/new worker messages even with a hot local cache.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
    check()
    const packed = accumulator.finish()
    check()
    return { packed, audit }
  } finally {
    clearTimeout(timer)
    params.signal.removeEventListener('abort', cancel)
    controller.abort()
  }
}
