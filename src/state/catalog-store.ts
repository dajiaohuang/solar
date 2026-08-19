import { filterCatalogRecords } from '../lib/catalogFilters'
import type { AsteroidManifest, AsteroidRecord, CatalogFilters, CatalogSummary, DatasetMode, DatasetProvenance } from '../types'
import { createStore } from './createStore'

export type { CatalogFilters } from '../types'
type CatalogState = {
  mode: DatasetMode
  datasetVersion: string
  requestedDatasetVersion: string | null
  manifest: AsteroidManifest | null
  provenance: DatasetProvenance | null
  summary: CatalogSummary | null
  baseSampleRecords: AsteroidRecord[]
  baseSampleKey: string | null
  browseRecords: AsteroidRecord[]
  activeResultRecords: AsteroidRecord[]
  activeResultScanKey: string | null
  exactFilteredTotal: number | null
  exactHydrationHasMore: boolean
  recordsSampled: boolean
  loadProgress: number
  selectionScope: {
    datasetVersion: string
    filters: CatalogFilters
    count: number
  } | null
  filters: CatalogFilters
  isLoading: boolean
  error: string | null
}

const initialCatalogState: CatalogState = {
  mode: 'lite',
  datasetVersion: 'unavailable',
  requestedDatasetVersion: null,
  manifest: null,
  provenance: null,
  summary: null,
  baseSampleRecords: [],
  baseSampleKey: null,
  browseRecords: [],
  activeResultRecords: [],
  activeResultScanKey: null,
  exactFilteredTotal: null,
  exactHydrationHasMore: false,
  recordsSampled: false,
  loadProgress: 0,
  selectionScope: null,
  filters: {
    query: '',
    orbitClass: 'all',
    semiMajorAxis: [0, 80],
    eccentricity: [0, 0.999],
    inclination: [0, 180],
    absoluteMagnitude: [-5, 40],
    magnitudeStatus: 'all',
    perihelion: [0, 80],
  },
  isLoading: false,
  error: null,
}

export const catalogStore = createStore(initialCatalogState)

export const catalogActions = {
  patch: catalogStore.setState,
  patchFilters(update: Partial<CatalogFilters>) {
    catalogStore.setState((state) => ({
      filters: { ...state.filters, ...update },
      browseRecords: update.query !== undefined && update.query !== state.filters.query ? [] : state.browseRecords,
      selectionScope: null,
      activeResultRecords: [],
      activeResultScanKey: null,
      exactFilteredTotal: null,
      exactHydrationHasMore: false,
      recordsSampled: Boolean(state.manifest && state.baseSampleRecords.length < state.manifest.totalCount),
      loadProgress: 0,
    }))
  },
  setBaseSample(key: string, records: AsteroidRecord[], summary: CatalogSummary | null) {
    catalogStore.setState({
      baseSampleKey: key,
      baseSampleRecords: records,
      summary,
      recordsSampled: true,
    })
  },
  setExactResult(scanKey: string, records: AsteroidRecord[], total: number, hasMore: boolean) {
    catalogStore.setState({
      activeResultRecords: records,
      activeResultScanKey: scanKey,
      exactFilteredTotal: total,
      exactHydrationHasMore: hasMore,
      recordsSampled: total > records.length || hasMore,
      loadProgress: 1,
      isLoading: false,
    })
  },
  setExactPage(records: AsteroidRecord[], hasMore: boolean) {
    catalogStore.setState((state) => ({
      activeResultRecords: records,
      exactHydrationHasMore: hasMore,
      recordsSampled: Boolean(state.exactFilteredTotal && (state.exactFilteredTotal > records.length || hasMore)),
      isLoading: false,
    }))
  },
  selectAllFiltered(datasetVersion: string, filters: CatalogFilters, count: number) {
    catalogStore.setState({
      selectionScope: {
        datasetVersion,
        filters: structuredClone(filters),
        count,
      },
    })
  },
  clearCatalogSelection() {
    catalogStore.setState({ selectionScope: null })
  },
}

export function catalogDisplayRecords(state: CatalogState, scanKey: string) {
  if (state.activeResultScanKey === scanKey) return state.activeResultRecords
  if (state.filters.query.trim()) return state.browseRecords
  return state.baseSampleRecords.length ? state.baseSampleRecords : state.browseRecords
}

export { filterCatalogRecords }
