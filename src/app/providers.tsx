import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { majorBodiesWithPhysicalData } from './bodyRegistry'
import { fetchSbdbBody } from '../data/loaders/sbdb'
import { simulationClock } from '../engine/clock/SimulationClock'
import { I18nProvider } from '../i18n/provider'
import { loadAsteroidBodiesByIds, loadAsteroidManifest, loadDatasetProvenance } from '../lib/catalogLoader'
import { encodeCurrentScene } from '../lib/shareScene'
import { decodeUrlState, type AppUrlState } from '../lib/urlState'
import { catalogActions, catalogStore, DEFAULT_CATALOG_FILTERS } from '../state/catalog-store'
import { DEFAULT_FOCUSED_ID, DEFAULT_SELECTED_IDS, selectionActions, selectionStore } from '../state/selection-store'
import { DEFAULT_SIMULATION_STATE, simulationActions, simulationStore } from '../state/simulation-store'
import { uiActions, uiStore } from '../state/ui-store'
import { DEFAULT_MISSION_STATE, missionActions, missionStore } from '../state/mission-store'
import { IS_NATIVE_APP } from '../lib/platform'
import { onNativeSceneLocation } from '../lib/nativeUrl'

const DEFAULT_STORY = 'geocentric-model'
const MISSION_BODY_IDS = new Set(majorBodiesWithPhysicalData.filter((body) => body.orbit && !body.parentId).map((body) => body.id))

function routeForState(state: AppUrlState) {
  if (state.route === 'home') return 'explorer'
  if (state.route) return state.route
  return 'explorer'
}

function discreteSceneKey() {
  const ui = uiStore.getState()
  const selection = selectionStore.getState()
  const mission = missionStore.getState()
  return JSON.stringify({
    route: ui.route,
    story: ui.route === 'stories' || ui.storyGuideOpen ? ui.storyId : null,
    step: ui.route === 'stories' || ui.storyGuideOpen ? ui.storyStep : null,
    guide: ui.storyGuideOpen,
    focused: selection.focusedId,
    mission: ui.route === 'mission' ? mission : null,
  })
}

function currentRelativeUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function nextRelativeUrl() {
  const url = new URL(encodeCurrentScene())
  return `${url.pathname}${url.search}${url.hash}`
}

export function AppProviders({ children }: { children: ReactNode }) {
  const initialized = useRef(false)
  const restoringHistory = useRef(false)
  const datasetLoadGeneration = useRef(0)

  const applyUrlState = useCallback((initial: AppUrlState) => {
    const route = routeForState(initial)
    const selectedIds = initial.bodies ?? DEFAULT_SELECTED_IDS
    const focusedId = initial.focused ?? (selectedIds.includes(DEFAULT_FOCUSED_ID) ? DEFAULT_FOCUSED_ID : selectedIds[0] ?? null)
    const language = initial.lang ?? uiStore.getState().language

    uiActions.navigate(route)
    uiActions.setLanguage(language)
    uiActions.setElementPlot(initial.plot ?? 'a-e')
    uiActions.selectStory(initial.story ?? DEFAULT_STORY, initial.step ?? 0)
    if (initial.guide) uiActions.startStory(initial.story ?? DEFAULT_STORY, initial.step ?? 0)
    else uiActions.stopStory()
    missionActions.patch({
      departureId: initial.missionFrom && MISSION_BODY_IDS.has(initial.missionFrom) ? initial.missionFrom : DEFAULT_MISSION_STATE.departureId,
      arrivalId: initial.missionTo && MISSION_BODY_IDS.has(initial.missionTo) ? initial.missionTo : DEFAULT_MISSION_STATE.arrivalId,
      departureDate: initial.departureDate ?? DEFAULT_MISSION_STATE.departureDate,
      arrivalDate: initial.arrivalDate ?? DEFAULT_MISSION_STATE.arrivalDate,
    })
    selectionActions.setSelectedIds(selectedIds)
    selectionActions.focus(focusedId)
    simulationActions.patch({
      ...DEFAULT_SIMULATION_STATE,
      viewOffset: initial.offset
        ? { x: initial.offset[0], y: initial.offset[1] }
        : { ...DEFAULT_SIMULATION_STATE.viewOffset },
      referenceId: initial.ref ?? DEFAULT_SIMULATION_STATE.referenceId,
      comparisonReferenceId: initial.compareRef ?? DEFAULT_SIMULATION_STATE.comparisonReferenceId,
      comparisonEnabled: initial.compare ?? DEFAULT_SIMULATION_STATE.comparisonEnabled,
      zoom: initial.zoom ?? DEFAULT_SIMULATION_STATE.zoom,
      historyDays: initial.history ?? DEFAULT_SIMULATION_STATE.historyDays,
      sampleCount: initial.samples ?? DEFAULT_SIMULATION_STATE.sampleCount,
      viewMode: initial.view ?? DEFAULT_SIMULATION_STATE.viewMode,
      renderQuality: initial.quality ?? DEFAULT_SIMULATION_STATE.renderQuality,
      showCatalogCloud: initial.catalogCloud ?? DEFAULT_SIMULATION_STATE.showCatalogCloud,
      showEcliptic: initial.layers?.includes('ecliptic') ?? DEFAULT_SIMULATION_STATE.showEcliptic,
      showOrbits: initial.layers?.includes('orbits') ?? DEFAULT_SIMULATION_STATE.showOrbits,
      showLagrange: initial.layers?.includes('lagrange') ?? DEFAULT_SIMULATION_STATE.showLagrange,
      showHillSphere: initial.layers?.includes('hill') ?? DEFAULT_SIMULATION_STATE.showHillSphere,
      showLaplaceSoi: initial.layers?.includes('soi') ?? DEFAULT_SIMULATION_STATE.showLaplaceSoi,
      showSpacecraft: initial.layers?.includes('spacecraft') ?? DEFAULT_SIMULATION_STATE.showSpacecraft,
    })
    simulationClock.pause()
    if (initial.jd !== undefined) simulationActions.seek(initial.jd)
    else simulationActions.resetTime()
    simulationActions.setRate(initial.speed ?? 30)

    catalogActions.patch({
      mode: initial.mode ?? 'lite',
      filters: {
        ...DEFAULT_CATALOG_FILTERS,
        semiMajorAxis: initial.aRange ?? DEFAULT_CATALOG_FILTERS.semiMajorAxis,
        eccentricity: initial.eRange ?? DEFAULT_CATALOG_FILTERS.eccentricity,
        inclination: initial.iRange ?? DEFAULT_CATALOG_FILTERS.inclination,
        absoluteMagnitude: initial.hRange ?? DEFAULT_CATALOG_FILTERS.absoluteMagnitude,
        perihelion: initial.qRange ?? DEFAULT_CATALOG_FILTERS.perihelion,
        orbitClass: initial.filter ?? DEFAULT_CATALOG_FILTERS.orbitClass,
        query: initial.search ?? DEFAULT_CATALOG_FILTERS.query,
        magnitudeStatus: initial.hStatus ?? DEFAULT_CATALOG_FILTERS.magnitudeStatus,
      },
      manifest: null,
      provenance: null,
      summary: null,
      datasetVersion: 'unavailable',
      requestedDatasetVersion: initial.dataset ?? null,
      requestedSampleProfile: initial.catalogSample ?? null,
      requestedSampleCount: initial.catalogSampleCount ?? null,
      requestedSampleCountRaw: initial.catalogSampleCountRaw ?? null,
      requestedSampleInvalid: initial.catalogSampleInvalid ?? false,
      selectionScope: null,
      baseSampleRecords: [],
      baseSampleKey: null,
      baseSampleProfile: null,
      browseRecords: [],
      activeResultRecords: [],
      activeResultScanKey: null,
      exactFilteredTotal: null,
      exactHydrationHasMore: false,
      recordsSampled: false,
      loadProgress: 0,
      isLoading: true,
      error: null,
      sampleError: null,
    })

    const loadGeneration = datasetLoadGeneration.current + 1
    datasetLoadGeneration.current = loadGeneration
    void loadAsteroidManifest(initial.dataset).then(async (manifest) => {
      const provenance = manifest ? await loadDatasetProvenance() : null
      if (datasetLoadGeneration.current !== loadGeneration) return
      catalogActions.patch({
        manifest,
        provenance,
        datasetVersion: manifest?.version ?? 'unavailable',
        requestedDatasetVersion: initial.dataset ?? null,
        mode: manifest?.datasetMode ?? initial.mode ?? 'lite',
        isLoading: false,
        error: !manifest && initial.dataset
          ? language === 'zh'
            ? `请求的数据集版本“${initial.dataset}”不可用。`
            : `Requested dataset version “${initial.dataset}” is not available.`
          : !manifest
            ? language === 'zh' ? '当前小行星数据集不可用。' : 'The current asteroid dataset is not available.'
            : null,
      })
      const [datasetBodies, sbdbBodies] = await Promise.all([
        manifest && selectedIds.some((id) => id.startsWith('asteroid:'))
          ? loadAsteroidBodiesByIds(selectedIds)
          : Promise.resolve([]),
        Promise.all(selectedIds.filter((id) => id.startsWith('sbdb:')).map((id) =>
          fetchSbdbBody(id.slice('sbdb:'.length).replaceAll('_', ' ')).catch(() => null))),
      ])
      if (datasetLoadGeneration.current !== loadGeneration) return
      selectionActions.addCatalogBodies([...datasetBodies, ...sbdbBodies.filter((body) => body !== null)])
    })
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    applyUrlState(decodeUrlState())
  }, [applyUrlState])

  useEffect(() => {
    let timeout: number | null = null
    let pendingPush = false
    let lastDiscreteKey = discreteSceneKey()
    let lastUrl = currentRelativeUrl()

    const flush = () => {
      timeout = null
      if (restoringHistory.current) return
      const url = nextRelativeUrl()
      const discreteKey = discreteSceneKey()
      if (url !== lastUrl) {
        if (pendingPush) window.history.pushState({ solarAtlas: true }, '', url)
        else window.history.replaceState({ solarAtlas: true }, '', url)
        lastUrl = url
      }
      lastDiscreteKey = discreteKey
      pendingPush = false
    }

    const schedule = () => {
      if (restoringHistory.current) return
      pendingPush = pendingPush || discreteSceneKey() !== lastDiscreteKey
      if (timeout !== null) window.clearTimeout(timeout)
      timeout = window.setTimeout(flush, pendingPush ? 60 : 500)
    }

    const handlePopState = () => {
      if (timeout !== null) window.clearTimeout(timeout)
      timeout = null
      pendingPush = false
      restoringHistory.current = true
      applyUrlState(decodeUrlState())
      queueMicrotask(() => {
        lastDiscreteKey = discreteSceneKey()
        lastUrl = currentRelativeUrl()
        restoringHistory.current = false
      })
    }

    const unsubscribers = [
      simulationStore.subscribe(schedule),
      selectionStore.subscribe(schedule),
      catalogStore.subscribe(schedule),
      missionStore.subscribe(schedule),
      uiStore.subscribe(schedule),
      simulationClock.subscribe(schedule),
    ]
    window.addEventListener('popstate', handlePopState)
    const unsubscribeNativeScene = IS_NATIVE_APP
      ? onNativeSceneLocation((location) => {
        if (location === currentRelativeUrl()) return
        window.history.pushState({ solarAtlas: true }, '', location)
        handlePopState()
      })
      : () => undefined
    return () => {
      if (timeout !== null) window.clearTimeout(timeout)
      window.removeEventListener('popstate', handlePopState)
      unsubscribeNativeScene()
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [applyUrlState])

  return <I18nProvider>{children}</I18nProvider>
}
