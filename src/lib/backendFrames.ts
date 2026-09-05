import { AU_IN_KM, SECONDS_PER_DAY } from '../engine/units'
import { MissingBodyStateError } from './ephemeris'
import type { BodyId, RenderedBodyPosition, Vector3 } from '../types'

export type BackendFrame = {
  currentPositions: RenderedBodyPosition[]
  missingBodyIds: BodyId[]
  maxDistance: number
  catalogManifestSha256: string
  inventoryManifestSha256?: string
  epochJd: number
  epochTdbJd: number
  audit: StateTileAudit[]
  absolutePositions: Map<BodyId, Vector3>
}

export type StateTileAudit = {
  bodyId: BodyId
  backendId: string
  availability: string
  precision: string
  source: string
  datasetVersion: string
  datasetSha256?: string
  kernelSha256?: string
  model: string
  centerId: string
  validityStartEt?: number
  validityEndEt?: number
  validityPresent?: boolean
  evidenceWindowStartEt?: number
  evidenceWindowEndEt?: number
  evidenceWindowPresent?: boolean
  identityStatus?: string
  sourceRecord?: boolean
  stateEvidence: string
  missingReason: string
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
