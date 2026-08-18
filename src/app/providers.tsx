import { useEffect, useRef, type ReactNode } from 'react'
import { simulationClock } from '../engine/clock/SimulationClock'
import { I18nProvider } from '../i18n/provider'
import { fetchSbdbBody } from '../data/loaders/sbdb'
import { loadAsteroidBodiesByIds, loadAsteroidManifest, loadDatasetProvenance } from '../lib/catalogLoader'
import { encodeCurrentScene } from '../lib/shareScene'
import { decodeUrlState } from '../lib/urlState'
import { catalogActions, catalogStore } from '../state/catalog-store'
import { selectionActions, selectionStore } from '../state/selection-store'
import { simulationActions, simulationStore } from '../state/simulation-store'
import { uiActions, uiStore } from '../state/ui-store'

export function AppProviders({ children }: { children: ReactNode }) {
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const initial = decodeUrlState()
    if (initial.route) uiActions.navigate(initial.route)
    if (initial.lang) uiActions.setLanguage(initial.lang)
    if (initial.plot) uiActions.setElementPlot(initial.plot)
    if (initial.bodies) selectionActions.setSelectedIds(initial.bodies)
    if (initial.focused) selectionActions.focus(initial.focused)
    simulationActions.patch({
      ...(initial.ref ? { referenceId: initial.ref } : {}),
      ...(initial.compareRef ? { comparisonReferenceId: initial.compareRef } : {}),
      comparisonEnabled: initial.compare ?? false,
      ...(initial.zoom ? { zoom: initial.zoom } : {}),
      ...(initial.history ? { historyDays: initial.history } : {}),
      ...(initial.view ? { viewMode: initial.view } : {}),
      ...(initial.offset ? { viewOffset: { x: initial.offset[0], y: initial.offset[1] } } : {}),
      ...(initial.layers !== undefined ? {
        showEcliptic: initial.layers.includes('ecliptic'),
        showOrbits: initial.layers.includes('orbits'),
        showLagrange: initial.layers.includes('lagrange'),
        showHillSphere: initial.layers.includes('hill'),
        showLaplaceSoi: initial.layers.includes('soi'),
        showSpacecraft: initial.layers.includes('spacecraft'),
      } : {}),
    })
    if (initial.jd) simulationActions.seek(initial.jd)
    if (initial.speed) simulationActions.setRate(initial.speed)
    catalogActions.patch({
      ...(initial.mode ? { mode: initial.mode } : {}),
      filters: {
        ...catalogStore.getState().filters,
        ...(initial.filter ? { orbitClass: initial.filter } : {}),
        ...(initial.search ? { query: initial.search } : {}),
        ...(initial.aRange ? { semiMajorAxis: initial.aRange } : {}),
        ...(initial.eRange ? { eccentricity: initial.eRange } : {}),
        ...(initial.iRange ? { inclination: initial.iRange } : {}),
        ...(initial.hRange ? { absoluteMagnitude: initial.hRange } : {}),
        ...(initial.qRange ? { perihelion: initial.qRange } : {}),
      },
      isLoading: true,
    })
    void loadAsteroidManifest(initial.dataset).then(async (manifest) => {
      const provenance = manifest ? await loadDatasetProvenance() : null
      catalogActions.patch({
        manifest,
        provenance,
        datasetVersion: manifest?.version ?? 'unavailable',
        mode: manifest?.datasetMode ?? initial.mode ?? 'lite',
        selectionScope: null,
        recordsComplete: false,
        loadProgress: 0,
        isLoading: false,
      })
      const selectedIds = initial.bodies ?? []
      const [datasetBodies, sbdbBodies] = await Promise.all([
        manifest && selectedIds.some((id) => id.startsWith('asteroid:'))
          ? loadAsteroidBodiesByIds(selectedIds)
          : Promise.resolve([]),
        Promise.all(selectedIds.filter((id) => id.startsWith('sbdb:')).map((id) =>
          fetchSbdbBody(id.slice('sbdb:'.length).replaceAll('_', ' ')).catch(() => null))),
      ])
      selectionActions.addCatalogBodies([...datasetBodies, ...sbdbBodies.filter((body) => body !== null)])
    })
  }, [])

  useEffect(() => {
    let timeout: number | null = null
    const schedule = () => {
      if (timeout !== null) return
      timeout = window.setTimeout(() => {
        timeout = null
        const url = new URL(encodeCurrentScene())
        window.history.replaceState(null, '', `${url.pathname}${url.search}`)
      }, 900)
    }
    const unsubscribers = [
      simulationStore.subscribe(schedule), selectionStore.subscribe(schedule), catalogStore.subscribe(schedule),
      uiStore.subscribe(schedule), simulationClock.subscribe(schedule),
    ]
    return () => {
      if (timeout !== null) window.clearTimeout(timeout)
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [])

  return <I18nProvider>{children}</I18nProvider>
}
