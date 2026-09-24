import type { AsteroidManifest, CatalogFilters, CatalogLocator } from '../types'
import { PREPARED_CATALOG_STRIDE, type PreparedCatalogElements } from '../engine/ephemeris/catalogPoints'
import { streamCatalogPoints, type CatalogStreamSourceCache } from './catalogStreaming'
import { checkCatalogAppendReceipt } from './catalogAppendReceipt'

/** Prepare one bounded addition using the same source checks and filters as the
 * initial stream. Nothing is installed in a renderer or epoch store here.
 * The caller must serialize this with initial loading/epoch computation and
 * charge its storage against an append-enabled plan before calling it.
 */
export async function prepareCatalogAppendBatch(options: {
  manifest: AsteroidManifest
  filters: CatalogFilters
  mode: '2d' | '3d'
  julianDay: number
  budgetBytes: number
  maximumRows: number
  locators: readonly CatalogLocator[]
  contentSha256: string
  indexSha256: string
  signal: AbortSignal
  yieldControl?: () => Promise<void>
  sourceCache?: CatalogStreamSourceCache
}) {
  options.signal.throwIfAborted()
  // Own the source and selection contract before any fetch or cooperative yield.
  options = { ...options, manifest: structuredClone(options.manifest),
    filters: structuredClone(options.filters), locators: structuredClone(options.locators) }
  const { manifest, locators, signal, maximumRows } = options
  if (!Number.isSafeInteger(maximumRows) || maximumRows < 1 || maximumRows > 256 ||
      !locators.length || locators.length > 256 ||
      manifest.contentSha256 !== options.contentSha256 ||
      !/^[a-f0-9]{64}$/.test(options.contentSha256) || !/^[a-f0-9]{64}$/.test(options.indexSha256)) {
    throw new RangeError('Invalid bounded catalog append request')
  }
  const candidates = new Uint32Array(locators.length*2), identities = new Set<number>()
  for (const [index, locator] of locators.entries()) {
    if (!Number.isSafeInteger(locator.chunkIndex) || locator.chunkIndex < 0 || locator.chunkIndex >= manifest.chunkCount ||
        !Number.isSafeInteger(locator.rowIndex) || locator.rowIndex < 0 || locator.rowIndex >= manifest.chunkSize ||
        locator.chunkIndex*manifest.chunkSize+locator.rowIndex >= manifest.totalCount) {
      throw new RangeError('Invalid catalog append source locator')
    }
    const identity = locator.chunkIndex*65536+locator.rowIndex
    if (identities.has(identity)) throw new RangeError('Duplicate catalog append source locator')
    identities.add(identity)
    candidates.set([locator.chunkIndex,locator.rowIndex],index*2)
  }
  const dimensions = options.mode === '3d' ? 3 : 2
  const positions = new Float64Array(maximumRows*dimensions)
  const appearance = new Uint8Array(maximumRows*2)
  const coefficients = new Float64Array(maximumRows*PREPARED_CATALOG_STRIDE)
  let preparedRows = 0, drawnRows = 0
  const result = await streamCatalogPoints({ manifest, filters: options.filters, mode: options.mode,
    julianDay: options.julianDay, requestedRows: maximumRows, budgetBytes: options.budgetBytes,
    candidateLocators: candidates, priorityLocators: locators, retainEpochs: true,
    signal, yieldControl: options.yieldControl, sourceCache: options.sourceCache,
    onPrepared: (prepared, startRow) => {
      if (startRow !== preparedRows || prepared.count+preparedRows > maximumRows) {
        throw new Error('Catalog append preparation exceeds its admitted row layout')
      }
      coefficients.set(prepared.data,startRow*PREPARED_CATALOG_STRIDE)
      preparedRows += prepared.count
    },
    onTile: async tile => {
      signal.throwIfAborted()
      const count = tile.positions.length/dimensions
      if (!Number.isSafeInteger(count) || drawnRows+count > maximumRows ||
          tile.drawnRows !== drawnRows+count || tile.drawnRows !== preparedRows || tile.appearance.length !== count*2) {
        throw new Error('Catalog append tile differs from prepared rows')
      }
      positions.set(tile.positions,drawnRows*dimensions)
      appearance.set(tile.appearance,drawnRows*2)
      drawnRows += count
    },
  })
  signal.throwIfAborted()
  checkCatalogAppendReceipt(result,{ manifest, locators, maximumRows,
    contentSha256: options.contentSha256, indexSha256: options.indexSha256 })
  const selection = result.sourceSelection
  if (!selection || selection.contentSha256 !== options.contentSha256 || selection.indexSha256 !== options.indexSha256 ||
      result.drawnRows !== drawnRows || preparedRows !== drawnRows) {
    throw new Error('Catalog append result differs from the frozen source or row layout')
  }
  const prepared: PreparedCatalogElements = { count: drawnRows,
    data: coefficients.slice(0,drawnRows*PREPARED_CATALOG_STRIDE) }
  return { julianDay: options.julianDay, mode: options.mode, prepared,
    positions: positions.slice(0,drawnRows*dimensions), appearance: appearance.slice(0,drawnRows*2),
    // Keep screening/complete evidence: omitted candidates must not be silently
    // described as failing filters when the row capacity stopped the search.
    result, requestedLocators: locators }
}
