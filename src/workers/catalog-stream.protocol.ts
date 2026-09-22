import type { AsteroidManifest, CatalogFilters } from '../types'
import type { CatalogStreamResult, CatalogStreamTile } from '../lib/catalogStreaming'

export type CatalogStreamRequest = {
  type: 'start'
  manifest: AsteroidManifest
  filters: CatalogFilters
  julianDay: number
  requestedRows: number
  budgetBytes: number
} | { type: 'ack'; tileId: number } | { type: 'cancel' }

export type CatalogStreamResponse =
  | ({ type: 'tile'; tileId: number } & CatalogStreamTile)
  | ({ type: 'done' } & CatalogStreamResult)
  | { type: 'error'; error: string }
  | { type: 'cancelled' }
