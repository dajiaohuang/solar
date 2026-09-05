import { useEffect, useSyncExternalStore } from 'react'
import { ensureKernelFiles, getEphemerisSnapshot, kernelFilesForBodies, subscribeEphemerides } from '../engine/ephemeris/kernelStore'
import { isOnboardingRendererReady, ONBOARDING_RENDER_READY_EVENT } from '../lib/onboarding'
import { majorBodiesWithPhysicalData } from '../app/bodyRegistry'
import { selectionStore } from '../state/selection-store'
import { simulationStore } from '../state/simulation-store'
import { uiStore } from '../state/ui-store'
import { missionStore } from '../state/mission-store'

export function useEphemerides() {
  return useSyncExternalStore(subscribeEphemerides, getEphemerisSnapshot)
}

/** No large transfer before the first-visit choice; Web assets load on demand. */
export function useEphemerisLoading() {
  useEffect(() => {
    let requested = ''
    const load = () => {
      if (!isOnboardingRendererReady() && uiStore.getState().route === 'explorer') return
      const selection = selectionStore.getState()
      const simulation = simulationStore.getState()
      const selected = new Set([...selection.selectedIds, selection.focusedId, simulation.referenceId, simulation.comparisonReferenceId])
      if (uiStore.getState().route === 'mission') {
        const mission = missionStore.getState()
        selected.add(mission.departureId)
        selected.add(mission.arrivalId)
      }
      const bodies = [...majorBodiesWithPhysicalData, ...Object.values(selection.catalogBodies)].filter((body) => selected.has(body.id))
      const ids = kernelFilesForBodies(bodies)
      const key = ids.join('|')
      if (requested === key) return
      requested = key
      void ensureKernelFiles(ids).catch(() => { requested = '' })
    }
    load()
    const unsubscribe = [selectionStore.subscribe(load), simulationStore.subscribe(load), uiStore.subscribe(load), missionStore.subscribe(load)]
    window.addEventListener(ONBOARDING_RENDER_READY_EVENT, load)
    return () => { unsubscribe.forEach((fn) => fn()); window.removeEventListener(ONBOARDING_RENDER_READY_EVENT, load) }
  }, [])
}
