import type { BodyId, CelestialBody } from '../types'
import { createStore } from './createStore'
import { bodyAvailability, sceneAvailability } from '../lib/productAvailability'
import { availabilityActions } from './availability-store'
import { parseSourceScene, sourceRecordBody, sourceSceneFromPage, sourcePinFor, type SourceSceneIdentity } from '../lib/sourceScene'
import type { SourceIdentityPage } from '../lib/sourceIdentityPage'

type SelectionState = {
  selectedIds: BodyId[]
  focusedId: BodyId | null
  catalogBodies: Record<BodyId, CelestialBody>
  savedCollections: Record<string, BodyId[]>
  sourceScene: SourceSceneIdentity | null
  sourceSceneEncoded: string | null
  sourceSceneError: string | null
  sourceBase: string | null
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
  sourceScene: null, sourceSceneEncoded: null, sourceSceneError: null, sourceBase: null,
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
  selectSourcePage(page: SourceIdentityPage, base: string) {
    const identity = sourceSceneFromPage(page), pin = sourcePinFor(identity, base)
    if (!availabilityActions.require(sceneAvailability({ bodies: identity.ids, sourceSelection: JSON.stringify(identity) }))) return false
    const retained = Object.fromEntries(Object.entries(selectionStore.getState().catalogBodies).filter(([, body]) => body.source !== 'source-inventory'))
    selectionStore.setState({ catalogBodies: { ...retained, ...Object.fromEntries(page.items.map(row => [row.id, sourceRecordBody(row.id, row)])) },
      selectedIds: [...identity.ids], focusedId: identity.ids[0], sourceScene: identity,
      sourceSceneEncoded: JSON.stringify(identity), sourceSceneError: null, sourceBase: pin.base })
    return true
  },
  restoreSourceScene(encoded: string | undefined, base: string | null, expectedIds?: BodyId[]) {
    const retained = Object.fromEntries(Object.entries(selectionStore.getState().catalogBodies).filter(([, body]) => body.source !== 'source-inventory'))
    if (encoded === undefined) {
      selectionStore.setState({ catalogBodies: retained, sourceScene: null, sourceSceneEncoded: null, sourceSceneError: null, sourceBase: null })
      return
    }
    try {
      const identity = parseSourceScene(encoded), pin = sourcePinFor(identity, base ?? '')
      if (expectedIds && (expectedIds.length !== identity.ids.length || expectedIds.some(id => !identity.ids.includes(id)))) throw new Error('Source selection IDs do not match its pinned identity')
      selectionStore.setState({ catalogBodies: { ...retained, ...Object.fromEntries(identity.ids.map(id => [id, sourceRecordBody(id)])) },
        selectedIds: [...identity.ids], sourceScene: identity, sourceSceneEncoded: JSON.stringify(identity), sourceSceneError: null, sourceBase: pin.base })
    } catch {
      selectionStore.setState({ catalogBodies: retained, selectedIds: encoded === undefined ? selectionStore.getState().selectedIds : [], sourceScene: null, sourceSceneEncoded: encoded,
        sourceSceneError: 'sourceIdentitySelectionError', sourceBase: null })
    }
  },
  setSelectedIds(selectedIds: BodyId[]) {
    if (!availabilityActions.require(sceneAvailability({ bodies: selectedIds }))) return false
    selectionStore.setState({ selectedIds: [...new Set(selectedIds)], sourceSceneError: null })
    return true
  },
  toggle(bodyId: BodyId) {
    if (!selectionStore.getState().selectedIds.includes(bodyId) && !availabilityActions.require(bodyAvailability(bodyId))) return false
    selectionStore.setState((state) => ({
      selectedIds: state.selectedIds.includes(bodyId)
        ? state.selectedIds.filter((id) => id !== bodyId)
        : [...state.selectedIds, bodyId],
    }))
  },
  focus(focusedId: BodyId | null) {
    if (!availabilityActions.require(bodyAvailability(focusedId))) return false
    selectionStore.setState({ focusedId })
  },
  addCatalogBodies(bodies: CelestialBody[], select = false) {
    if (!availabilityActions.require(sceneAvailability({ bodies: bodies.map(body => body.id) }))) return false
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
