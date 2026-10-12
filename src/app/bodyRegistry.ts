import { useMemo, useSyncExternalStore } from 'react'
import { SEGMENTED_WEB } from '../lib/webExecution'
import { subscribeApproximation, getApproximationSnapshot } from '../engine/ephemeris/segmentedStore'
import { subscribeEphemerides, getEphemerisSnapshot } from '../engine/ephemeris/kernelStore'
import { majorBodies } from '../data/majorBodies'
import { SCIENTIFIC_SPACECRAFT } from '../data/scientificSpacecraft'
import { BODY_PHYSICAL } from '../data/physical'
import { selectionStore } from '../state/selection-store'
import type { BodyId, CelestialBody } from '../types'

export const majorBodiesWithPhysicalData = majorBodies.map((body) => ({
  ...body,
  radiusKm: BODY_PHYSICAL[body.id]?.radiusKm,
}))
export const builtInSceneBodies: CelestialBody[] = [...majorBodiesWithPhysicalData, ...SCIENTIFIC_SPACECRAFT]

export function useBodyRegistry() {
  const ephemerisRevision = useSyncExternalStore(SEGMENTED_WEB ? subscribeApproximation : subscribeEphemerides,
    SEGMENTED_WEB ? () => getApproximationSnapshot().revision : () => getEphemerisSnapshot().revision)
  const { catalogBodies, selectedIds } = selectionStore.useStore()
  const registry = useMemo(() => {
    // Pinned inventory records can share canonical IDs with built-ins. Keep
    // their selected source ownership, without duplicate list/worker rows.
    const bodiesById = new Map<BodyId, CelestialBody>([...builtInSceneBodies, ...Object.values(catalogBodies)].map((body) => [body.id, body]))
    const allBodies = [...bodiesById.values()]
    return {
      allBodies,
      bodiesById,
      selectedBodies: selectedIds.map((id) => bodiesById.get(id)).filter((body): body is CelestialBody => Boolean(body)),
    }
  }, [catalogBodies, selectedIds])
  // Installing coefficients changes available positions, not body identity.
  // Stable selection/maps keep camera ownership and worker scene keys intact.
  return { ...registry, ephemerisRevision }
}
