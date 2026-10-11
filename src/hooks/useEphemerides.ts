import { useEffect, useSyncExternalStore } from 'react'
import { ensureKernelFiles, getEphemerisSnapshot, kernelFilesForBodies, subscribeEphemerides } from '../engine/ephemeris/kernelStore'
import { isOnboardingRendererReady, ONBOARDING_RENDER_READY_EVENT } from '../lib/onboarding'
import { builtInSceneBodies } from '../app/bodyRegistry'
import { selectionStore } from '../state/selection-store'
import { simulationStore } from '../state/simulation-store'
import { uiStore } from '../state/ui-store'
import { missionStore } from '../state/mission-store'
import { simulationClock } from '../engine/clock/SimulationClock'
import { SEGMENTED_WEB } from '../lib/webExecution'
import { approximationRequestKey, ensureApproximation, getApproximationManifest, loadApproximationManifest, getApproximationSnapshot, subscribeApproximation } from '../engine/ephemeris/segmentedStore'

const builtInById = new Map(builtInSceneBodies.map(body => [body.id, body]))
const subscribe = SEGMENTED_WEB ? subscribeApproximation : subscribeEphemerides
const getSnapshot = SEGMENTED_WEB ? getApproximationSnapshot : getEphemerisSnapshot

export function useEphemerides() {
  return useSyncExternalStore(subscribe, getSnapshot)
}

const getRevision = () => getSnapshot().revision
const getBusy = () => getSnapshot().loading > 0

/** Stable primitive snapshots avoid rendering scientific views on status-only
 * changes while retaining React's external-store consistency checks. */
export function useEphemerisRevision() {
  return useSyncExternalStore(subscribe, getRevision)
}

export function useEphemerisBusy() {
  return useSyncExternalStore(subscribe, getBusy)
}

/** No large transfer before the first-visit choice; Web assets load on demand. */
export function useEphemerisLoading() {
  useEffect(() => {
    let requested: string | null = null
    let currentKey: string | null = null
    let generation = 0
    let retryCount = 0
    let active = true
    let pendingController: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
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
      const bodies = [...selected].flatMap(id => {
        if (!id) return []
        const body = Object.hasOwn(selection.catalogBodies, id) ? selection.catalogBodies[id] : builtInById.get(id)
        return body ? [body] : []
      })
      const ids = kernelFilesForBodies(bodies)
      const julianDay = simulationClock.getJulianDay()
      const key = SEGMENTED_WEB ? approximationRequestKey(bodies, julianDay) : JSON.stringify(ids)
      if (requested === key) return
      if (currentKey !== key) {
        pendingController?.abort()
        pendingController = null
        clearTimeout(retryTimer)
        retryTimer = undefined
        retryCount = 0
        currentKey = key
      }
      requested = key
      const attempt = ++generation
      const controller = new AbortController()
      pendingController = controller
      // URL restoration can change the scene while its manifest is loading.
      // Re-read the selected bodies afterwards, rather than downloading the
      // initial default scene that the user never requested.
      const operation = SEGMENTED_WEB
        ? getApproximationManifest() ? ensureApproximation(bodies, julianDay, julianDay, controller.signal) : loadApproximationManifest()
        : ensureKernelFiles(ids, controller.signal)
      void operation.then(() => {
        if (SEGMENTED_WEB && active && generation === attempt && !controller.signal.aborted) load()
      }).catch(() => {
        // Clock/store updates cannot turn a persistent failure into a busy
        // retry loop. Manual loading remains available after these retries.
        if (!active || generation !== attempt || controller.signal.aborted || retryCount >= 3) return
        const delay = 1000 * 2 ** retryCount++
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          if (!active || generation !== attempt) return
          requested = null
          load()
        }, delay)
      }).finally(() => {
        if (pendingController === controller) pendingController = null
      })
    }
    load()
    const unsubscribe = [selectionStore.subscribe(load), simulationStore.subscribe(load), uiStore.subscribe(load), missionStore.subscribe(load)]
    if (SEGMENTED_WEB) unsubscribe.push(simulationClock.subscribe(load))
    window.addEventListener(ONBOARDING_RENDER_READY_EVENT, load)
    return () => {
      active = false
      generation += 1
      pendingController?.abort()
      pendingController = null
      clearTimeout(retryTimer)
      unsubscribe.forEach((fn) => fn())
      window.removeEventListener(ONBOARDING_RENDER_READY_EVENT, load)
    }
  }, [])
}
