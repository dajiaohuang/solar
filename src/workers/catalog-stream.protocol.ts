import type { AsteroidManifest, CatalogFilters } from '../types'
import type { CatalogStreamResult, CatalogStreamTile } from '../lib/catalogStreaming'
import type { CatalogSpatialView } from '../lib/catalogSpatialSelection'

export type CatalogStreamRequest = {
  type: 'start'
  mode?: '2d' | '3d'
  manifest: AsteroidManifest
  filters: CatalogFilters
  julianDay: number
  requestedRows: number
  budgetBytes: number
} | { type: 'ack'; tileId: number } | { type: 'cancel' }
  | { type: 'view'; requestId: number; count: number; view: CatalogSpatialView }

export type CatalogStreamResponse =
  | ({ type: 'tile'; tileId: number } & CatalogStreamTile)
  | ({ type: 'done' } & CatalogStreamResult)
  | { type: 'error'; error: string }
  | { type: 'cancelled' }
  | { type: 'selection'; requestId: number; count: number; indices: Uint32Array; visible: number }
