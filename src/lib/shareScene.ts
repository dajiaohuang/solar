import { simulationClock } from '../engine/clock/SimulationClock'
import { catalogStore } from '../state/catalog-store'
import { selectionStore } from '../state/selection-store'
import { simulationStore } from '../state/simulation-store'
import { uiStore } from '../state/ui-store'
import { missionStore } from '../state/mission-store'
import { encodeUrlState } from './urlState'
import { CANONICAL_APP_URL, IS_NATIVE_APP } from './platform'
import { VIEW_CAPABILITIES } from './viewCapabilities'

function sceneBaseUrl() {
  if (IS_NATIVE_APP || typeof window === 'undefined') return CANONICAL_APP_URL
  return `${window.location.origin}${window.location.pathname}`
}

export function encodeCurrentScene() {
  const simulation = simulationStore.getState()
  const selection = selectionStore.getState()
  const catalog = catalogStore.getState()
  const ui = uiStore.getState()
  const mission = missionStore.getState()
  const capabilities = VIEW_CAPABILITIES[simulation.viewMode]
  if (ui.route === 'home') {
    const language = ui.language === 'zh' ? '?lang=zh' : ''
    return `${sceneBaseUrl()}${language}`
  }
  const resolvedSampleProfile = catalog.baseSampleProfile ?? catalog.requestedSampleProfile ?? undefined
  const resolvedSampleCount = catalog.baseSampleProfile
    ? catalog.baseSampleRecords.length
    : catalog.requestedSampleCount ?? undefined
  const unresolvedSampleCountRaw = catalog.baseSampleProfile
    ? undefined
    : catalog.requestedSampleCountRaw ?? undefined
  const query = encodeUrlState({
    route: ui.route,
    dataset: catalog.datasetVersion !== 'unavailable'
      ? catalog.datasetVersion
      : catalog.requestedDatasetVersion ?? undefined,
    mode: catalog.mode,
    catalogSample: resolvedSampleProfile,
    catalogSampleCount: resolvedSampleCount,
    catalogSampleCountRaw: unresolvedSampleCountRaw,
    ref: simulation.referenceId,
    compareRef: simulation.comparisonReferenceId,
    compare: simulation.comparisonEnabled,
    bodies: selection.selectedIds,
    jd: simulationClock.getJulianDay(),
    zoom: simulation.zoom,
    speed: simulationClock.getSnapshot().rateDaysPerSecond,
    history: simulation.historyDays,
    samples: simulation.sampleCount,
    view: simulation.viewMode,
    catalogCloud: simulation.showCatalogCloud,
    quality: simulation.renderQuality,
    filter: catalog.filters.orbitClass,
    search: catalog.filters.query,
    story: ui.route === 'stories' || ui.storyGuideOpen ? ui.storyId : undefined,
    step: ui.route === 'stories' || ui.storyGuideOpen ? ui.storyStep : undefined,
    guide: ui.storyGuideOpen,
    missionFrom: ui.route === 'mission' ? mission.departureId : undefined,
    missionTo: ui.route === 'mission' ? mission.arrivalId : undefined,
    departureDate: ui.route === 'mission' ? mission.departureDate : undefined,
    arrivalDate: ui.route === 'mission' ? mission.arrivalDate : undefined,
    focused: selection.focusedId ?? undefined,
    plot: ui.elementPlot,
    aRange: catalog.filters.semiMajorAxis,
    eRange: catalog.filters.eccentricity,
    iRange: catalog.filters.inclination,
    hRange: catalog.filters.absoluteMagnitude,
    hStatus: catalog.filters.magnitudeStatus,
    qRange: catalog.filters.perihelion,
    layers: [
      ...(simulation.showEcliptic ? ['ecliptic' as const] : []),
      ...(capabilities.fullOrbits && simulation.showOrbits ? ['orbits' as const] : []),
      ...(simulation.showLagrange ? ['lagrange' as const] : []),
      ...(capabilities.hillSphere && simulation.showHillSphere ? ['hill' as const] : []),
      ...(capabilities.laplaceSoi && simulation.showLaplaceSoi ? ['soi' as const] : []),
      ...(simulation.showSpacecraft ? ['spacecraft' as const] : []),
    ],
    offset: capabilities.offset ? [simulation.viewOffset.x, simulation.viewOffset.y] : undefined,
    lang: ui.language,
  })
  return `${sceneBaseUrl()}${query ? `?${query}` : ''}`
}
