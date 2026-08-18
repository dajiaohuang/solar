import { useMemo } from 'react'
import { majorBodies } from '../data/majorBodies'
import { BODY_PHYSICAL } from '../data/physical'
import { selectionStore } from '../state/selection-store'
import type { BodyId, CelestialBody } from '../types'

export const majorBodiesWithPhysicalData = majorBodies.map((body) => ({
  ...body,
  radiusKm: BODY_PHYSICAL[body.id]?.radiusKm,
}))

export function useBodyRegistry() {
  const { catalogBodies, selectedIds } = selectionStore.useStore()
  return useMemo(() => {
    const allBodies = [...majorBodiesWithPhysicalData, ...Object.values(catalogBodies)]
    const bodiesById = new Map<BodyId, CelestialBody>(allBodies.map((body) => [body.id, body]))
    return {
      allBodies,
      bodiesById,
      selectedBodies: selectedIds.map((id) => bodiesById.get(id)).filter((body): body is CelestialBody => Boolean(body)),
    }
  }, [catalogBodies, selectedIds])
}
