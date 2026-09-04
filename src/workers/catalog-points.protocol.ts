export type CatalogPointWorkerRequest =
  | { type: 'initialize'; requestId: number; elements: Float64Array }
  | { type: 'reset'; requestId: number }
  | { type: 'compute'; requestId: number; julianDay: number }

export type CatalogPointWorkerResponse =
  | { type: 'initialized'; requestId: number }
  | { type: 'progress'; requestId: number; progress?: number }
  | { type: 'result'; requestId: number; progress?: number; julianDay: number; positions: Float32Array; positions3D: Float32Array }
  | { type: 'error'; requestId: number; error?: string }
