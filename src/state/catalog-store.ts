import type { AsteroidManifest, AsteroidRecord, DatasetMode, DatasetProvenance } from '../types'
import { createStore } from './createStore'

export type CatalogFilters = {
  query: string
  orbitClass: string
  semiMajorAxis: [number, number]
  eccentricity: [number, number]
  inclination: [number, number]
  absoluteMagnitude: [number, number]
  perihelion: [number, number]
}
type CatalogState = {
  mode: DatasetMode
  datasetVersion: string
  manifest: AsteroidManifest | null
  provenance: DatasetProvenance | null
  records: AsteroidRecord[]
  recordsComplete: boolean
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
  manifest: null,
  provenance: null,
  records: [],
  recordsComplete: false,
  loadProgress: 0,
  selectionScope: null,
  filters: {
    query: '',
    orbitClass: 'all',
    semiMajorAxis: [0, 80],
    eccentricity: [0, 0.999],
    inclination: [0, 180],
    absoluteMagnitude: [-5, 40],
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

export function filterCatalogRecords(records: AsteroidRecord[], filters: CatalogFilters) {
  const query = filters.query.trim().toLowerCase()
  return records.filter((record) => {
    const perihelion = record.semiMajorAxisAU * (1 - record.eccentricity)
    return (!query || record.searchKey.includes(query) || record.label.toLowerCase().includes(query)) &&
      (filters.orbitClass === 'all' || record.orbitClassCode === filters.orbitClass) &&
      record.semiMajorAxisAU >= filters.semiMajorAxis[0] && record.semiMajorAxisAU <= filters.semiMajorAxis[1] &&
      record.eccentricity >= filters.eccentricity[0] && record.eccentricity <= filters.eccentricity[1] &&
      record.inclinationDeg >= filters.inclination[0] && record.inclinationDeg <= filters.inclination[1] &&
      (record.absoluteMagnitude === undefined ||
        (record.absoluteMagnitude >= filters.absoluteMagnitude[0] && record.absoluteMagnitude <= filters.absoluteMagnitude[1])) &&
      perihelion >= filters.perihelion[0] && perihelion <= filters.perihelion[1]
  })
}
