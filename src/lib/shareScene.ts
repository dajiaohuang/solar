import { simulationClock } from '../engine/clock/SimulationClock'
import { catalogStore } from '../state/catalog-store'
import { selectionStore } from '../state/selection-store'
import { simulationStore } from '../state/simulation-store'
import { uiStore } from '../state/ui-store'
import { encodeUrlState } from './urlState'

export function encodeCurrentScene() {
  const simulation = simulationStore.getState()
  const selection = selectionStore.getState()
  const catalog = catalogStore.getState()
  const ui = uiStore.getState()
  const query = encodeUrlState({
    route: ui.route,
    dataset: catalog.datasetVersion === 'unavailable' ? undefined : catalog.datasetVersion,
    mode: catalog.mode,
    ref: simulation.referenceId,
    compareRef: simulation.comparisonReferenceId,
    compare: simulation.comparisonEnabled,
    bodies: selection.selectedIds,
    jd: simulationClock.getJulianDay(),
    zoom: simulation.zoom,
    speed: simulationClock.getSnapshot().rateDaysPerSecond,
    history: simulation.historyDays,
    view: simulation.viewMode,
    filter: catalog.filters.orbitClass,
    search: catalog.filters.query,
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
      ...(simulation.showOrbits ? ['orbits' as const] : []),
      ...(simulation.showLagrange ? ['lagrange' as const] : []),
      ...(simulation.showHillSphere ? ['hill' as const] : []),
      ...(simulation.showLaplaceSoi ? ['soi' as const] : []),
      ...(simulation.showSpacecraft ? ['spacecraft' as const] : []),
    ],
    offset: [simulation.viewOffset.x, simulation.viewOffset.y],
    lang: ui.language,
  })
  return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ''}`
}
