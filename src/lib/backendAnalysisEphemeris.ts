import { backendBodyId } from './currentStateIdentity'
import { fetchStateWindow } from './stateWindowClient'
import { StateTileSnapshot, type StateTileMetadata } from './stateTiles'
import { AU_IN_KM, SECONDS_PER_DAY } from '../engine/units'
import { utcJulianDayToEt, utcJulianDayToTdb, utcTimeScaleQuality } from '../engine/ephemeris/timeScales'
import type { AnalysisBodyEvidence, AnalysisEphemerisEvidence, AnalysisEphemerisProvider } from '../engine/ephemeris/analysisEphemeris'
import type { BodyId, CelestialBody, Vector3 } from '../types'

const MAX_ANALYSIS_EPOCHS = 1024
const MAX_ANALYSIS_BODIES = 32
const MAX_ANALYSIS_STATES = 262_144
const MAX_ANALYSIS_AUDIT_BYTES = 2 * 1024 * 1024

export type BackendAnalysisStateAudit = {
  schemaVersion: 1
  kind: 'backend-state-window'
  catalogVersion: string
  catalogManifestSha256: string
  inventoryManifestSha256?: string
  epochsTdbJd: number[]
  /** Application body order, with the Sun appended as the final reference row. */
  bodyIds: BodyId[]
  /** Backend identities aligned position-for-position with bodyIds. */
  backendIds: string[]
  /** Deduplicated backend request identities, in request order. */
  uniqueBackendIds: string[]
  /** Epoch-major indices into sources; includes the Sun reference state. */
  sourceOrdinals: number[]
  sources: StateTileMetadata[]
  plans: { epochIndex: number; planHash: string }[]
  tiles: { epochIndex: number; sequence: number; ordinalStart: number; recordCount: number; payloadSha256: string }[]
}

export type BackendAnalysisEphemeris = AnalysisEphemerisProvider & {
  backendStateAudit: BackendAnalysisStateAudit
}

function checkedBodyId(body: CelestialBody): string {
  const id = backendBodyId(body)
  if (!id || id.length > 512) throw new RangeError(`Backend analysis has no bounded identity for ${body.id}`)
  return id
}

function sourceRow(row: ReturnType<StateTileSnapshot['rowAt']>): StateTileMetadata {
  return {
    id: row.backendId, source: row.source, datasetVersion: row.datasetVersion, datasetSha256: row.datasetSha256,
    kernelSha256: row.kernelSha256, sourceChainSha256: row.sourceChainSha256, model: row.model,
    centerId: row.centerId, validityStartEt: row.validityStartEt, validityEndEt: row.validityEndEt,
    validityPresent: row.validityPresent, stateEvidence: row.stateEvidence,
    evidenceWindowStartEt: row.evidenceWindowStartEt, evidenceWindowEndEt: row.evidenceWindowEndEt,
    evidenceWindowPresent: row.evidenceWindowPresent, missingReason: row.missingReason,
    identityStatus: row.identityStatus, sourceRecord: row.sourceRecord,
  }
}

/** Loads a finite set of exact backend states and exposes the same synchronous
 * Sun-relative ECLIPJ2000 query contract used by local mission calculations. */
export async function loadBackendAnalysisEphemeris(params: {
  base: string
  bodiesById: ReadonlyMap<BodyId, CelestialBody>
  bodyIds: readonly BodyId[]
  epochUtcJds: readonly number[]
  signal: AbortSignal
  fetcher?: typeof fetch
  expectedCatalogManifestSha256?: string
  expectedInventoryManifestSha256?: string
}): Promise<BackendAnalysisEphemeris> {
  if (!params.base.trim() || params.base.length > 2048 || !Array.isArray(params.bodyIds) ||
      params.bodyIds.length < 1 || params.bodyIds.length > MAX_ANALYSIS_BODIES ||
      !Array.isArray(params.epochUtcJds) || params.epochUtcJds.length < 1 || params.epochUtcJds.length > MAX_ANALYSIS_EPOCHS ||
      params.bodyIds.length * params.epochUtcJds.length > MAX_ANALYSIS_STATES ||
      params.bodyIds.some((id, index) => typeof id !== 'string' || !id || params.bodyIds.indexOf(id) !== index) ||
      params.bodyIds.includes('sun' as BodyId) ||
      params.epochUtcJds.some((jd, index) => !Number.isFinite(jd) || index > 0 && jd <= params.epochUtcJds[index - 1])) {
    throw new RangeError('Invalid shared backend analysis window')
  }
  params.signal.throwIfAborted()
  const sun = params.bodiesById.get('sun')
  if (!sun) throw new RangeError('Shared backend analysis requires the registered Sun identity')
  const bodies = params.bodyIds.map(id => {
    const body = params.bodiesById.get(id)
    if (!body) throw new RangeError(`Unknown analysis body: ${id}`)
    return body
  })
  const appBodyIds = [...params.bodyIds, 'sun' as BodyId]
  const appBodies = [...bodies, sun]
  const requested = new Map<BodyId, string>()
  const backendIds = appBodies.map(body => {
    const id = checkedBodyId(body)
    requested.set(body.id, id)
    return id
  })
  const uniqueBackendIds = [...new Set(backendIds)]
  const epochsByUtc = params.epochUtcJds.map(utcJulianDayToTdb)
  const epochsTdbJd = [...new Set(epochsByUtc)].sort((a, b) => a - b)
  if (epochsTdbJd.length !== params.epochUtcJds.length ||
      epochsTdbJd.some((jd, index) => !Number.isFinite(jd) || index > 0 && jd <= epochsTdbJd[index - 1])) {
    throw new RangeError('Analysis UTC epochs do not map to distinct ordered TDB epochs')
  }
  const stateAtTdb = new Map<number, Map<BodyId, Float64Array>>()
  const sourceIndexes = new Map<string, number>(), sources: StateTileMetadata[] = []
  const sourceOrdinals = new Array<number>(epochsTdbJd.length * appBodyIds.length)
  const plans: BackendAnalysisStateAudit['plans'] = [], tiles: BackendAnalysisStateAudit['tiles'] = []
  let manifest: { catalogVersion: string; catalogManifestSha256: string; inventoryManifestSha256?: string } | null = null
  let auditBytes = 0
  const encoder = new TextEncoder()
  const chargeAudit = (value: unknown) => {
    auditBytes += encoder.encode(JSON.stringify(value)).byteLength
    if (auditBytes > MAX_ANALYSIS_AUDIT_BYTES) throw new RangeError('Shared backend analysis provenance exceeds 2 MiB')
  }
  chargeAudit({ bodyIds: appBodyIds, backendIds, uniqueBackendIds, epochsTdbJd })
  for await (const item of fetchStateWindow({ base: params.base.trim().replace(/\/+$/, ''), bodyIds: uniqueBackendIds,
    epochsTdbJd, signal: params.signal, fetcher: params.fetcher,
    expectedCatalogManifestSha256: params.expectedCatalogManifestSha256,
    expectedInventoryManifestSha256: params.expectedInventoryManifestSha256 })) {
    params.signal.throwIfAborted()
    if (!manifest) manifest = { catalogVersion: item.manifest.catalogVersion,
      catalogManifestSha256: item.manifest.catalogManifestSha256, inventoryManifestSha256: item.manifest.inventoryManifestSha256 }
    else if (manifest.catalogVersion !== item.manifest.catalogVersion || manifest.catalogManifestSha256 !== item.manifest.catalogManifestSha256 ||
        manifest.inventoryManifestSha256 !== item.manifest.inventoryManifestSha256) {
      throw new Error('Backend analysis manifest changed inside the state window')
    }
    const snapshot = new StateTileSnapshot(item.tiles, requested)
    const epochStates = new Map<BodyId, Float64Array>()
    for (let bodyOffset = 0; bodyOffset < appBodyIds.length; bodyOffset++) {
      const bodyId = appBodyIds[bodyOffset], index = snapshot.indexOf(bodyId)
      if (index < 0 || snapshot.statusAt(index) !== 'exact') {
        const reason = index < 0 ? 'identity-not-received' : snapshot.missingReasonAt(index)
        throw new Error(`Backend exact state unavailable for ${bodyId} at TDB JD ${epochsTdbJd[item.epochIndex]}: ${reason}`)
      }
      const row = snapshot.rowAt(index), metadata = sourceRow(row)
      // The audit-epoch inventory snapshots are exact only at their declared
      // epoch; they are not valid endpoints for a finite-time transfer.
      if (metadata.model !== 'spk-original' || row.backendId !== requested.get(bodyId) ||
          !metadata.kernelSha256 || !/^[a-f0-9]{64}$/.test(metadata.kernelSha256) || metadata.centerId !== 'naif:0') {
        throw new Error(`Backend mission state for ${bodyId} is not an original SPK evaluation`)
      }
      const sourceKey = JSON.stringify(metadata)
      let sourceOrdinal = sourceIndexes.get(sourceKey)
      if (sourceOrdinal === undefined) {
        chargeAudit(metadata)
        sourceOrdinal = sources.length
        sourceIndexes.set(sourceKey, sourceOrdinal)
        sources.push(metadata)
      }
      sourceOrdinals[item.epochIndex * appBodyIds.length + bodyOffset] = sourceOrdinal
      const state = new Float64Array(6)
      for (let field = 0; field < state.length; field++) state[field] = snapshot.stateValueAt(index, field)
      epochStates.set(bodyId, state)
    }
    stateAtTdb.set(epochsTdbJd[item.epochIndex], epochStates)
    chargeAudit({ epochIndex: item.epochIndex, planHash: item.plan.planHash })
    plans.push({ epochIndex: item.epochIndex, planHash: item.plan.planHash })
    for (const tile of item.tiles) {
      const receipt = { epochIndex: item.epochIndex, sequence: tile.sequence, ordinalStart: tile.ordinalStart,
        recordCount: tile.recordCount, payloadSha256: tile.payloadSha256 }
      chargeAudit(receipt); tiles.push(receipt)
    }
  }
  params.signal.throwIfAborted()
  if (!manifest || plans.length !== epochsTdbJd.length || plans.some((plan, index) => plan.epochIndex !== index) ||
      stateAtTdb.size !== epochsTdbJd.length || !Array.from(sourceOrdinals).every(value => Number.isSafeInteger(value) && value >= 0 && value < sources.length)) {
    throw new Error('Backend analysis state window did not complete coherently')
  }
  chargeAudit(sourceOrdinals)
  const backendStateAudit: BackendAnalysisStateAudit = {
    schemaVersion: 1, kind: 'backend-state-window', ...manifest, epochsTdbJd: [...epochsTdbJd],
    bodyIds: appBodyIds, backendIds, uniqueBackendIds, sourceOrdinals, sources, plans, tiles,
  }
  const actualSources = new Map<string, { id: string; sha256: string }>()
  for (const metadata of sources) {
    const sha256 = metadata.kernelSha256!
    const id = `${metadata.source}@${sha256}`
    actualSources.set(id, { id, sha256 })
  }
  const kernelPool = [...actualSources.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const models: AnalysisBodyEvidence[] = bodies.map(body => ({ bodyId: body.id, model: 'jpl-spk', source: body.source }))
  models.push({ bodyId: 'sun', model: 'heliocentric-origin', source: sun.source })
  const bodyModels = (ids?: readonly BodyId[]) => models.filter(body => !ids || ids.includes(body.bodyId)).map(body => ({ ...body }))
  const evidence: AnalysisEphemerisEvidence = {
    schemaVersion: 1, policy: 'require-spk', inputTimeScale: 'UTC', dynamicalTimeScale: 'TDB',
    timeScaleQuality: utcTimeScaleQuality(Math.max(...params.epochUtcJds)), frame: 'ECLIPJ2000', origin: 'Sun',
    positionUnit: 'AU', velocityUnit: 'AU/d', startJulianDay: Math.min(...params.epochUtcJds),
    endJulianDay: Math.max(...params.epochUtcJds), manifestId: `backend:${manifest.catalogVersion}:${manifest.catalogManifestSha256}`,
    kernelPool, bodies: bodyModels(), physicalPredictionUncertainty: 'not-estimated',
  }
  const requireEpoch = (utcJd: number) => {
    if (!Number.isFinite(utcJd) || utcJd < evidence.startJulianDay || utcJd > evidence.endJulianDay) {
      throw new RangeError('Mission epoch lies outside the fetched backend state window')
    }
    const tdbJd = utcJulianDayToTdb(utcJd), states = stateAtTdb.get(tdbJd)
    if (!states) throw new RangeError('Mission epoch was not part of the fetched backend state window')
    return states
  }
  return {
    backendStateAudit,
    bodyModels,
    at(utcJd: number) {
      const states = requireEpoch(utcJd), sunState = states.get('sun' as BodyId)!
      const stateFor = (bodyId: BodyId) => {
        const state = states.get(bodyId)
        if (!state) throw new RangeError(`Body ${bodyId} was not included in the backend state window`)
        return state
      }
      const vector = (bodyId: BodyId, offset: 0 | 3): Vector3 => {
        if (bodyId === 'sun') return { x: 0, y: 0, z: 0 }
        const state = stateFor(bodyId), scale = offset === 0 ? 1 / AU_IN_KM : SECONDS_PER_DAY / AU_IN_KM
        return { x: (state[offset] - sunState[offset]) * scale, y: (state[offset + 1] - sunState[offset + 1]) * scale,
          z: (state[offset + 2] - sunState[offset + 2]) * scale }
      }
      return Object.freeze({ position: (bodyId: BodyId) => vector(bodyId, 0), velocity: (bodyId: BodyId) => vector(bodyId, 3) })
    },
    elapsedDays(startUtcJd: number, endUtcJd: number) {
      requireEpoch(startUtcJd); requireEpoch(endUtcJd)
      if (endUtcJd <= startUtcJd) throw new RangeError('Mission dates must be ordered')
      return (utcJulianDayToEt(endUtcJd) - utcJulianDayToEt(startUtcJd)) / SECONDS_PER_DAY
    },
    evidence: () => ({ ...evidence, timeScaleQuality: evidence.timeScaleQuality ? {
      ...evidence.timeScaleQuality, assumptions: [...evidence.timeScaleQuality.assumptions], sources: [...evidence.timeScaleQuality.sources],
    } : null, kernelPool: evidence.kernelPool.map(file => ({ ...file })), bodies: bodyModels() }),
  }
}
