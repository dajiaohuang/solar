import { filterCatalogRecords } from '../lib/catalogFilters'
import type { AsteroidManifest, AsteroidRecord, CatalogFilters, DatasetMode, DatasetProvenance } from '../types'
import { createStore } from './createStore'

export type { CatalogFilters } from '../types'
type CatalogState = {
  mode: DatasetMode
  datasetVersion: string
  requestedDatasetVersion: string | null
  manifest: AsteroidManifest | null
  provenance: DatasetProvenance | null
  records: AsteroidRecord[]
  recordsComplete: boolean
  filteredTotal: number | null
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
  records: [],
  recordsComplete: false,
  filteredTotal: null,
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
      selectionScope: null,
      recordsComplete: false,
      filteredTotal: null,
      recordsSampled: false,
      loadProgress: 0,
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

export { filterCatalogRecords }
