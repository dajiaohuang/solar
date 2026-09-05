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
  evidence: BackendStateEvidence
}

/** A shared scientific snapshot. Scalar/ID reads do not create audit rows;
 * evidence pages and explicitly requested positions are materialized on demand. */
export type BackendStateEvidence = {
  readonly length: number
  bodyIdAt(index: number): BodyId
  backendIdAt(index: number): string
  statusAt(index: number): 'exact' | 'approximate' | 'missing'
  missingReasonAt(index: number): string
  rowAt(index: number): StateTileAudit
  hasPosition(bodyId: BodyId): boolean
  positionAu(bodyId: BodyId): Vector3 | undefined
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

export function createBackendPositionResolver(readPosition: (bodyId: BodyId) => Vector3 | undefined, epochJd = NaN) {
  return (bodyId: BodyId): Vector3 => {
    const position = readPosition(bodyId)
    if (!position) throw new MissingBodyStateError(bodyId, epochJd)
    return position
  }
}

export function kmToAu(value: number) { return value / AU_IN_KM }
export function kmPerSecondToAuPerDay(value: number) { return value * SECONDS_PER_DAY / AU_IN_KM }
