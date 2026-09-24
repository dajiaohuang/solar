import type { AsteroidManifest, CatalogFilters, CatalogLocator } from '../types'
import type { CatalogStreamPriority, CatalogStreamResult, CatalogStreamTile } from '../lib/catalogStreaming'
import type { CatalogSpatialView } from '../lib/catalogSpatialSelection'
import type { CatalogEpochReuse, CatalogEpochResult } from '../lib/catalogEpochStore'

export type CatalogStreamRequest = {
  type: 'start'
  mode?: '2d' | '3d'
  retainEpochs?: boolean
  /** Reserved within requestedRows, not in addition to that total ceiling. */
  appendRows?: number
  priority?: CatalogStreamPriority
  priorityLocators?: readonly CatalogLocator[]
  /** Benchmark-only phase timing receipt; normal application requests omit it. */
  capturePerformanceReceipt?: boolean
  manifest: AsteroidManifest
  filters: CatalogFilters
  julianDay: number
  requestedRows: number
  budgetBytes: number
} | { type: 'ack'; tileId: number; positions?: Float64Array } | { type: 'cancel' } | { type: 'view-cancel' }
  | { type: 'view'; requestId: number; count: number; view: CatalogSpatialView }
  | { type: 'epoch'; requestId: number; julianDay: number; maximumDriftAU?: number }
  | { type: 'epoch-ack'; requestId: number; startRow: number; positions: Float64Array }
  | { type: 'epoch-reuse-ack'; requestId: number; startRow: number; count: number }
  | { type: 'append'; requestId: number; startRow: number; julianDay: number; locators: readonly CatalogLocator[] }
  | { type: 'append-ack'; requestId: number; startRow: number; count: number }

export type CatalogStreamResponse =
  | ({ type: 'tile'; tileId: number } & CatalogStreamTile)
  | ({ type: 'done'; retainedEpochs?: boolean } & CatalogStreamResult)
  | { type: 'error'; error: string }
  | { type: 'cancelled' }
  | { type: 'selection-error'; requestId: number; count: number; error: string }
  | { type: 'selection'; requestId: number; count: number; indices: Uint32Array; visible: number; edgeCandidates: number; selectionMs: number; testedRows?: number; skippedRows?: number }
  | { type: 'epoch-start'; requestId: number; julianDay: number; count: number }
  | { type: 'epoch-tile'; requestId: number; julianDay: number; startRow: number; count: number; positions: Float64Array }
  | ({ type: 'epoch-reuse'; requestId: number } & CatalogEpochReuse)
  | ({ type: 'epoch-done'; requestId: number } & CatalogEpochResult)
  | { type: 'epoch-error'; requestId: number; error: string }
  | { type: 'append-error'; requestId: number; error: string }
  | { type: 'append-tile'; requestId: number; startRow: number; count: number; julianDay: number;
      positions: Float64Array; appearance: Uint8Array; result: CatalogStreamResult }
  | { type: 'append-done'; requestId: number; startRow: number; addedRows: number; count: number; julianDay: number; result: CatalogStreamResult }
