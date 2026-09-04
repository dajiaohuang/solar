import { AU_IN_KM, SECONDS_PER_DAY } from '../engine/units'
import { MissingBodyStateError } from './ephemeris'
import type { BodyId, CelestialBody, RenderedBodyPosition, Vector3 } from '../types'

export { backendBodyId } from './currentStateIdentity'

export const CURRENT_STATES_API_VERSION = 'solar.api/v1'
export const CURRENT_STATES_FRAME = 'ECLIPJ2000'
export const CURRENT_STATES_TIME_SCALE = 'TDB'
export const CURRENT_STATES_STATE_LAYOUT = 'row-major-[x,y,z,vx,vy,vz]'
export const MAX_CURRENT_STATE_BATCH = 510
const SHA256 = /^[a-f0-9]{64}$/
const EXACT_CURRENT_STATE_MODELS = new Set(['spk-original', 'source-kernel-state-at-audit-epoch', 'exact-only', 'unavailable-no-kernel'])

const AVAILABILITIES = new Set(['operational', 'fallback', 'snapshot', 'missing'])

export type BackendCapabilities = {
  apiVersion: string
  catalogVersion: string
  manifestSha256: string
  inventoryManifestSha256?: string
  limits: { currentStateIDsMax: number }
  contract: { timeScale: string; frame: string; distanceUnit: string; velocityUnit: string; precisionModes: string[]; nBody: boolean; currentStates: { precision: 'exact-only'; stateOriginId: 'naif:0' }; auditIdentities: AuditIdentityTuple[] }
}

export type AuditIdentityTuple = { source: string; datasetVersion: string; model: string }

export type CurrentStatesResponse = {
  apiVersion: string
  catalogVersion: string
  catalogManifestSha256: string
  inventoryManifestSha256?: string
  epochJd: number
  timeScale: string
  frame: string
  distanceUnit: string
  velocityUnit: string
  stateLayout: string
  stateStride: number
  stateOriginId: string
  ids: string[]
  availability: string[]
  precision: string[]
  source: string[]
  datasetVersion: string[]
  model: string[]
  centerIds: string[]
  validityStartEt: number[]
  validityEndEt: number[]
  validityPresent: boolean[]
  stateEvidence: string[]
  evidenceWindowStartEt: number[]
  evidenceWindowEndEt: number[]
  evidenceWindowPresent: boolean[]
  missingReason: string[]
  identityStatus: string[]
  sourceRecord: boolean[]
  statePresent: boolean[]
  stateValues: number[]
}

export type BackendFrame = {
  currentPositions: RenderedBodyPosition[]
  missingBodyIds: BodyId[]
  maxDistance: number
  catalogManifestSha256: string
  inventoryManifestSha256?: string
  epochJd: number
  epochTdbJd: number
  audit: CurrentStateAudit[]
  absolutePositions: Map<BodyId, Vector3>
}

export type CurrentStateAudit = {
  bodyId: BodyId
  backendId: string
  availability: string
  precision: string
  source: string
  datasetVersion: string
  model: string
  centerId: string
  validityStartEt?: number
  validityEndEt?: number
  stateEvidence: string
  missingReason: string
}

export function splitCurrentStateBatches(ids: readonly string[], max = MAX_CURRENT_STATE_BATCH): string[][] {
  if (!Number.isSafeInteger(max) || max < 1 || max > MAX_CURRENT_STATE_BATCH) throw new RangeError('Invalid current-state batch size')
  const unique = [...new Set(ids)]
  const batches: string[][] = []
  for (let index = 0; index < unique.length; index += max) batches.push(unique.slice(index, index + max))
  return batches
}

function requireString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid current-state ${name}`)
  return value
}

export function validateCapabilities(raw: unknown): BackendCapabilities {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid current-state capabilities')
  const value = raw as Record<string, unknown>
  if (value.apiVersion !== CURRENT_STATES_API_VERSION) throw new Error('Unsupported current-state API version')
  const catalogVersion = requireString(value.catalogVersion, 'catalog version')
  const manifestSha256 = requireString(value.manifestSha256, 'catalog manifest hash')
  if (!SHA256.test(manifestSha256)) throw new Error('Invalid catalog manifest hash')
  const contract = value.contract as Record<string, unknown> | undefined
  if (!contract || contract.timeScale !== CURRENT_STATES_TIME_SCALE || contract.frame !== CURRENT_STATES_FRAME
    || contract.distanceUnit !== 'km' || contract.velocityUnit !== 'km/s' || contract.nBody !== false
    || !Array.isArray(contract.precisionModes) || !contract.precisionModes.includes('exact')
    || !contract.precisionModes.includes('approximate-opt-in')
    || contract.precisionModes.some(mode => mode !== 'exact' && mode !== 'approximate-opt-in')) throw new Error('Unsupported current-state contract')
  const currentStates = contract.currentStates as Record<string, unknown> | undefined
  if (!currentStates || currentStates.precision !== 'exact-only' || currentStates.stateOriginId !== 'naif:0') throw new Error('Unsupported current-states endpoint contract')
  const identities = contract.auditIdentities as unknown
  const auditRows = Array.isArray(identities) ? identities as Array<Record<string, unknown>> : []
  if (auditRows.length === 0 || auditRows.some(item => !item || typeof item !== 'object' || typeof item.source !== 'string' || !item.source.trim() || typeof item.datasetVersion !== 'string' || !item.datasetVersion.trim() || typeof item.model !== 'string' || !item.model.trim())) throw new Error('Missing current-state audit identities')
  const auditIdentities = auditRows.map(item => ({ source: item.source as string, datasetVersion: item.datasetVersion as string, model: item.model as string }))
  if (auditIdentities.some(identity => !EXACT_CURRENT_STATE_MODELS.has(identity.model))) throw new Error('Capabilities advertise a non-exact current-state model')
  const tupleKeys = auditIdentities.map(item => `${item.source}\u0000${item.datasetVersion}\u0000${item.model}`)
  if (new Set(tupleKeys).size !== tupleKeys.length) throw new Error('Duplicate current-state audit identities')
  const limits = value.limits as Record<string, unknown> | undefined
  const currentStateIDsMax = limits?.currentStateIDsMax
  if (typeof currentStateIDsMax !== 'number' || !Number.isSafeInteger(currentStateIDsMax) || currentStateIDsMax < MAX_CURRENT_STATE_BATCH) {
    throw new Error('Backend current-state batch limit is too small')
  }
  const sourceInventory = value.coverage && typeof value.coverage === 'object'
    ? (value.coverage as Record<string, unknown>).sourceInventory : undefined
  let inventoryManifestSha256: string | undefined
  if (sourceInventory !== undefined) {
    if (!sourceInventory || typeof sourceInventory !== 'object') throw new Error('Invalid inventory audit metadata')
    const hash = (sourceInventory as Record<string, unknown>).manifestSha256
    if (hash === undefined) throw new Error('Missing inventory manifest hash')
    inventoryManifestSha256 = requireString(hash, 'inventory manifest hash')
    if (!SHA256.test(inventoryManifestSha256)) throw new Error('Invalid inventory manifest hash')
  }
  return { apiVersion: CURRENT_STATES_API_VERSION, catalogVersion, manifestSha256, inventoryManifestSha256,
    limits: { currentStateIDsMax: currentStateIDsMax as number },
    contract: {
      timeScale: contract.timeScale as string, frame: contract.frame as string,
      distanceUnit: contract.distanceUnit as string, velocityUnit: contract.velocityUnit as string,
      precisionModes: contract.precisionModes as string[], nBody: contract.nBody as boolean,
      currentStates: { precision: 'exact-only', stateOriginId: 'naif:0' }, auditIdentities,
    } }
}

function assertArray(value: unknown, name: string, length: number) {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`Invalid current-state ${name} column length`)
}

export function validateCurrentStates(raw: unknown, capabilities: BackendCapabilities, epochTdbJd: number, expectedIds?: readonly string[]): CurrentStatesResponse {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid current-state response')
  const response = raw as Partial<CurrentStatesResponse>
  if (response.apiVersion !== capabilities.apiVersion || response.catalogVersion !== capabilities.catalogVersion
    || response.catalogManifestSha256 !== capabilities.manifestSha256) throw new Error('Current-state audit identity mismatch')
  if (typeof response.catalogManifestSha256 !== 'string' || !SHA256.test(response.catalogManifestSha256)) throw new Error('Invalid current-state catalog hash')
  if (capabilities.inventoryManifestSha256 !== undefined && response.inventoryManifestSha256 !== capabilities.inventoryManifestSha256) {
    throw new Error('Current-state inventory audit identity mismatch')
  }
  if (response.inventoryManifestSha256 !== undefined && (typeof response.inventoryManifestSha256 !== 'string' || !SHA256.test(response.inventoryManifestSha256))) throw new Error('Invalid current-state inventory hash')
  if (!Number.isFinite(response.epochJd) || Math.abs(response.epochJd! - epochTdbJd) > 1e-9
    || response.timeScale !== CURRENT_STATES_TIME_SCALE || response.frame !== CURRENT_STATES_FRAME
    || response.distanceUnit !== 'km' || response.velocityUnit !== 'km/s'
    || response.stateLayout !== CURRENT_STATES_STATE_LAYOUT || response.stateStride !== 6 || response.stateOriginId !== 'naif:0') throw new Error('Current-state numeric contract mismatch')
  const ids = response.ids
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_CURRENT_STATE_BATCH || ids.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid current-state IDs')
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate current-state IDs')
  if (expectedIds && (expectedIds.length !== ids.length || expectedIds.some((id, index) => id !== ids[index]))) throw new Error('Current-state ID order mismatch')
  const columns: [keyof CurrentStatesResponse, string][] = [
    ['availability', 'availability'], ['precision', 'precision'], ['source', 'source'], ['datasetVersion', 'dataset version'],
    ['model', 'model'], ['centerIds', 'center IDs'], ['validityStartEt', 'validity start'], ['validityEndEt', 'validity end'],
    ['validityPresent', 'validity presence'], ['stateEvidence', 'state evidence'], ['evidenceWindowStartEt', 'evidence start'],
    ['evidenceWindowEndEt', 'evidence end'], ['evidenceWindowPresent', 'evidence presence'], ['missingReason', 'missing reason'],
    ['identityStatus', 'identity status'], ['sourceRecord', 'source record'], ['statePresent', 'state presence'],
  ]
  for (const [key, name] of columns) assertArray(response[key], name, ids.length)
  const stringColumns: (keyof CurrentStatesResponse)[] = ['source', 'datasetVersion', 'model', 'centerIds', 'stateEvidence', 'missingReason', 'identityStatus']
  for (const key of stringColumns) if ((response[key] as unknown[]).some(value => typeof value !== 'string')) throw new Error(`Invalid current-state ${String(key)} element`)
  const booleanColumns: (keyof CurrentStatesResponse)[] = ['validityPresent', 'evidenceWindowPresent', 'sourceRecord', 'statePresent']
  for (const key of booleanColumns) if ((response[key] as unknown[]).some(value => typeof value !== 'boolean')) throw new Error(`Invalid current-state ${String(key)} element`)
  const numericColumns: (keyof CurrentStatesResponse)[] = ['validityStartEt', 'validityEndEt', 'evidenceWindowStartEt', 'evidenceWindowEndEt']
  for (const key of numericColumns) if ((response[key] as unknown[]).some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`Invalid current-state ${String(key)} element`)
  if (!Array.isArray(response.stateValues) || response.stateValues.length !== ids.length * 6 || response.stateValues.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid current-state values')
  for (let index = 0; index < ids.length; index += 1) {
    const availability = response.availability![index]
    if (typeof availability !== 'string' || !AVAILABILITIES.has(availability)) throw new Error('Unknown current-state availability')
    if (availability === 'fallback') throw new Error('Current-state response contains fallback availability')
    if (response.precision![index] !== 'exact') throw new Error('Current-state response is not exact')
    const source = response.source![index]
    if (typeof source !== 'string') throw new Error('Invalid current-state source')
    const datasetVersion = response.datasetVersion![index]
    const model = response.model![index]
    if (typeof datasetVersion !== 'string' || typeof model !== 'string') throw new Error('Invalid current-state model metadata')
    if (model && !EXACT_CURRENT_STATE_MODELS.has(model)) throw new Error('Current-state response uses a non-exact model')
    if (source || datasetVersion || model) {
      const knownIdentity = capabilities.contract.auditIdentities.some(identity => identity.source === source && identity.datasetVersion === datasetVersion && identity.model === model)
      if (!knownIdentity) throw new Error('Unknown current-state audit identity')
    }
    if (response.statePresent![index] !== true && response.statePresent![index] !== false) throw new Error('Invalid current-state presence')
    if (response.statePresent![index] && availability !== 'operational' && availability !== 'snapshot') throw new Error('Present state has invalid availability')
    if (!response.statePresent![index] && availability !== 'missing') throw new Error('Unavailable state must be marked missing')
    if (response.statePresent![index] && ((availability === 'operational' && model !== 'spk-original') || (availability === 'snapshot' && model !== 'source-kernel-state-at-audit-epoch'))) throw new Error('Present state has invalid model')
    if (response.statePresent![index] && (model === 'exact-only' || model === 'unavailable-no-kernel')) throw new Error('Unavailable model cannot have a state')
    if (response.statePresent![index] && (!source || !datasetVersion || !model || !response.stateEvidence![index])) throw new Error('Exact state is missing audit identity')
    if (response.validityPresent![index] && (!Number.isFinite(response.validityStartEt![index]) || !Number.isFinite(response.validityEndEt![index]) || response.validityEndEt![index] < response.validityStartEt![index])) throw new Error('Invalid current-state validity window')
    if (response.evidenceWindowPresent![index] && (!Number.isFinite(response.evidenceWindowStartEt![index]) || !Number.isFinite(response.evidenceWindowEndEt![index]) || response.evidenceWindowEndEt![index] < response.evidenceWindowStartEt![index])) throw new Error('Invalid current-state evidence window')
  }
  return response as CurrentStatesResponse
}

function subtract(a: Vector3, b: Vector3): Vector3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }

export function buildBackendFrame(params: {
  bodies: CelestialBody[]
  referenceId: BodyId
  requestedIds: Map<BodyId, string>
  responses: CurrentStatesResponse[]
}): BackendFrame {
  const byBackendId = new Map<string, { response: CurrentStatesResponse; index: number }>()
  for (const response of params.responses) response.ids.forEach((id, index) => byBackendId.set(id, { response, index }))
  const absolute = new Map<string, Vector3>()
  const audit = new Map<string, CurrentStateAudit>()
  for (const [bodyId, backendId] of params.requestedIds) {
    const row = byBackendId.get(backendId)
    if (!row) continue
    const { response, index } = row
    audit.set(bodyId, { bodyId, backendId, availability: response.availability[index], precision: response.precision[index], source: response.source[index], datasetVersion: response.datasetVersion[index], model: response.model[index], centerId: response.centerIds[index], ...(response.validityPresent[index] ? { validityStartEt: response.validityStartEt[index], validityEndEt: response.validityEndEt[index] } : {}), stateEvidence: response.stateEvidence[index], missingReason: response.missingReason[index] })
    if (!response.statePresent[index]) continue
    absolute.set(backendId, { x: response.stateValues[index * 6] / AU_IN_KM, y: response.stateValues[index * 6 + 1] / AU_IN_KM, z: response.stateValues[index * 6 + 2] / AU_IN_KM })
  }
  const bodyAbsolute = new Map<BodyId, Vector3>()
  for (const [bodyId, backendId] of params.requestedIds) {
    const position = absolute.get(backendId)
    if (position) bodyAbsolute.set(bodyId, position)
  }
  const referenceBackendId = params.requestedIds.get(params.referenceId)
  const reference = referenceBackendId ? absolute.get(referenceBackendId) : undefined
  const currentPositions: RenderedBodyPosition[] = []
  const missingBodyIds: BodyId[] = []
  for (const body of params.bodies) {
    const backendId = params.requestedIds.get(body.id)
    const position = backendId ? absolute.get(backendId) : undefined
    const rowAudit = audit.get(body.id)
    // The backend returns common-origin (SSB/NAIF 0) states. centerIds are
    // provenance only; they are not additional rows to request or sum.
    const sourceCompatible = Boolean(rowAudit?.source)
    if (!position || !reference || !sourceCompatible || rowAudit?.availability === 'missing') { missingBodyIds.push(body.id); continue }
    const relative = subtract(position, reference)
    currentPositions.push({ body, planarPosition: { x: relative.x, y: relative.y }, position3D: relative, distance: Math.hypot(relative.x, relative.y, relative.z) })
  }
  return { currentPositions, missingBodyIds, maxDistance: currentPositions.reduce((max, item) => Math.max(max, item.distance), 0),
    catalogManifestSha256: params.responses[0]?.catalogManifestSha256 ?? '', inventoryManifestSha256: params.responses[0]?.inventoryManifestSha256,
    // epochJd is already TDB. UTC conversion happens once in the hook before
    // any request leaves the browser.
    epochJd: params.responses[0]?.epochJd ?? NaN, epochTdbJd: params.responses[0]?.epochJd ?? NaN, audit: [...audit.values()], absolutePositions: bodyAbsolute }
}

export function createBackendPositionResolver(absolutePositions: ReadonlyMap<BodyId, Vector3>, epochJd = NaN) {
  return (bodyId: BodyId): Vector3 => {
    const position = absolutePositions.get(bodyId)
    if (!position) throw new MissingBodyStateError(bodyId, epochJd)
    return position
  }
}

export function kmToAu(value: number) { return value / AU_IN_KM }
export function kmPerSecondToAuPerDay(value: number) { return value * SECONDS_PER_DAY / AU_IN_KM }
