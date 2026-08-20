import { catalogStore } from '../state/catalog-store'
import { encodeCurrentScene } from './shareScene'

export const SCENE_LIBRARY_SCHEMA_VERSION = 1 as const
const STORAGE_KEY = 'solar-atlas-scenes-v1'
const MAX_SCENES = 40

export type SavedScene = {
  schemaVersion: typeof SCENE_LIBRARY_SCHEMA_VERSION
  id: string
  title: string
  notes: string
  url: string
  datasetVersion: string | null
  createdAt: string
  updatedAt: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function storageOrNull(storage?: StorageLike): StorageLike | null {
  if (storage) return storage
  try { return localStorage } catch { return null }
}

function isSafeSceneUrl(value: unknown) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value, 'https://dajiaohuang.github.io/solar/')
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function isSavedScene(value: unknown): value is SavedScene {
  if (!value || typeof value !== 'object') return false
  const scene = value as Partial<SavedScene>
  return scene.schemaVersion === SCENE_LIBRARY_SCHEMA_VERSION && typeof scene.id === 'string' && typeof scene.title === 'string' &&
    typeof scene.notes === 'string' && isSafeSceneUrl(scene.url) && typeof scene.createdAt === 'string' && Number.isFinite(Date.parse(scene.createdAt)) && typeof scene.updatedAt === 'string' && Number.isFinite(Date.parse(scene.updatedAt)) &&
    (scene.datasetVersion === null || typeof scene.datasetVersion === 'string')
}

export function parseSceneLibrary(value: string): SavedScene[] {
  const parsed = JSON.parse(value) as unknown
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'scenes' in parsed && (parsed as { schemaVersion?: unknown }).schemaVersion !== SCENE_LIBRARY_SCHEMA_VERSION) {
    throw new Error('Unsupported Solar Atlas scene-library version')
  }
  const candidates = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' && 'scenes' in parsed ? (parsed as { scenes: unknown }).scenes : null)
  if (!Array.isArray(candidates)) throw new Error('Invalid Solar Atlas scene library')
  const scenes = candidates.filter(isSavedScene)
  if (scenes.length !== candidates.length) throw new Error('Scene library contains an unsupported or malformed scene')
  return scenes.slice(0, MAX_SCENES)
}

export function loadSavedScenes(storage?: StorageLike): SavedScene[] {
  const target = storageOrNull(storage)
  if (!target) return []
  try {
    const value = target.getItem(STORAGE_KEY)
    return value ? parseSceneLibrary(value) : []
  } catch {
    return []
  }
}

export function persistSavedScenes(scenes: SavedScene[], storage?: StorageLike) {
  const target = storageOrNull(storage)
  if (!target) return
  target.setItem(STORAGE_KEY, JSON.stringify(scenes.slice(0, MAX_SCENES)))
}

export function saveCurrentScene(title: string, notes = '', storage?: StorageLike) {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('Scene title is required')
  const now = new Date().toISOString()
  const catalog = catalogStore.getState()
  const existing = loadSavedScenes(storage)
  const scene: SavedScene = {
    schemaVersion: SCENE_LIBRARY_SCHEMA_VERSION,
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: trimmed.slice(0, 120),
    notes: notes.trim().slice(0, 2_000),
    url: encodeCurrentScene(),
    datasetVersion: catalog.datasetVersion === 'unavailable' ? catalog.requestedDatasetVersion : catalog.datasetVersion,
    createdAt: now,
    updatedAt: now,
  }
  const scenes = [scene, ...existing].slice(0, MAX_SCENES)
  persistSavedScenes(scenes, storage)
  return scenes
}

export function removeSavedScene(id: string, storage?: StorageLike) {
  const scenes = loadSavedScenes(storage).filter((scene) => scene.id !== id)
  persistSavedScenes(scenes, storage)
  return scenes
}

export function mergeSceneLibrary(imported: SavedScene[], storage?: StorageLike) {
  const scenesById = new Map(loadSavedScenes(storage).map((scene) => [scene.id, scene]))
  for (const scene of imported) scenesById.set(scene.id, scene)
  const scenes = [...scenesById.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, MAX_SCENES)
  persistSavedScenes(scenes, storage)
  return scenes
}

export function sceneLibraryDocument(scenes: SavedScene[]) {
  return JSON.stringify({
    schemaVersion: SCENE_LIBRARY_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    application: 'Solar Atlas',
    scenes,
  }, null, 2)
}

export function localizeSavedSceneUrl(sceneUrl: string, currentHref = window.location.href) {
  const scene = new URL(sceneUrl, 'https://dajiaohuang.github.io/solar/')
  const current = new URL(currentHref)
  current.search = scene.search
  current.hash = scene.hash
  return current.toString()
}
