import type { BodyId } from '../types'

export type StoredGroup = {
  name: string
  majorBodyIds: BodyId[]
  catalogBodyIds: BodyId[]
  createdAt: string
}

const STORAGE_KEY = 'solar-custom-groups'

export function loadGroups(): Record<string, StoredGroup> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }

    return JSON.parse(raw) as Record<string, StoredGroup>
  } catch {
    return {}
  }
}

export function saveGroup(name: string, majorBodyIds: BodyId[], catalogBodyIds: BodyId[]) {
  const groups = loadGroups()
  groups[name] = {
    name,
    majorBodyIds,
    catalogBodyIds,
    createdAt: new Date().toISOString(),
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups))
}

export function deleteGroup(name: string) {
  const groups = loadGroups()
  delete groups[name]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups))
}
