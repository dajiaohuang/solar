import type { BodyId, CelestialBody } from '../types'
import { createStore } from './createStore'

type SelectionState = {
  selectedIds: BodyId[]
  focusedId: BodyId | null
  catalogBodies: Record<BodyId, CelestialBody>
  savedCollections: Record<string, BodyId[]>
}
function loadCollections() {
  try {
    const parsed = JSON.parse(localStorage.getItem('solar-atlas-collections') ?? '{}') as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, BodyId[]> : {}
  } catch {
    return {}
  }
}

export const DEFAULT_SELECTED_IDS: BodyId[] = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn']
export const DEFAULT_FOCUSED_ID: BodyId = 'earth'

const initialSelectionState: SelectionState = {
  selectedIds: DEFAULT_SELECTED_IDS,
  focusedId: DEFAULT_FOCUSED_ID,
  catalogBodies: {},
  savedCollections: typeof window === 'undefined' ? {} : loadCollections(),
}

export const selectionStore = createStore(initialSelectionState)

function persistCollections(collections: Record<string, BodyId[]>) {
  try {
    localStorage.setItem('solar-atlas-collections', JSON.stringify(collections))
  } catch {
    // Storage is optional (private browsing and disabled storage are supported).
  }
}

export const selectionActions = {
  setSelectedIds(selectedIds: BodyId[]) {
    selectionStore.setState({ selectedIds: [...new Set(selectedIds)] })
  },
  toggle(bodyId: BodyId) {
    selectionStore.setState((state) => ({
      selectedIds: state.selectedIds.includes(bodyId)
        ? state.selectedIds.filter((id) => id !== bodyId)
        : [...state.selectedIds, bodyId],
    }))
  },
  focus(focusedId: BodyId | null) {
    selectionStore.setState({ focusedId })
  },
  addCatalogBodies(bodies: CelestialBody[], select = false) {
    selectionStore.setState((state) => ({
      catalogBodies: {
        ...state.catalogBodies,
        ...Object.fromEntries(bodies.map((body) => [body.id, body])),
      },
      selectedIds: select
        ? [...new Set([...state.selectedIds, ...bodies.map((body) => body.id)])]
        : state.selectedIds,
    }))
  },
  clearCatalogBodies() {
    selectionStore.setState((state) => ({
      catalogBodies: {},
      selectedIds: state.selectedIds.filter((id) => !id.startsWith('asteroid:') && !id.startsWith('sbdb:')),
    }))
  },
  saveCollection(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    selectionStore.setState((state) => {
      const savedCollections = { ...state.savedCollections, [trimmed]: state.selectedIds }
      persistCollections(savedCollections)
      return { savedCollections }
    })
  },
  removeCollection(name: string) {
    selectionStore.setState((state) => {
      const savedCollections = { ...state.savedCollections }
      delete savedCollections[name]
      persistCollections(savedCollections)
      return { savedCollections }
    })
  },
}
