import type { CatalogPointMode } from '../engine/ephemeris/catalogPoints'

export type CatalogPointWorkerRequest =
  | { type: 'initialize'; requestId: number; elements: Float64Array }
  | { type: 'reset'; requestId: number }
  | { type: 'compute'; requestId: number; julianDay: number; mode: CatalogPointMode }

export type CatalogPointWorkerResponse =
  | { type: 'initialized'; requestId: number }
  | { type: 'progress'; requestId: number; progress?: number }
  | { type: 'result'; requestId: number; progress?: number; julianDay: number; mode: CatalogPointMode; positions: Float32Array }
  | { type: 'error'; requestId: number; error?: string }
