import { dateToJulianDay } from './julianDate'
import { catalogActions, DEFAULT_CATALOG_FILTERS } from '../state/catalog-store'
import { selectionActions } from '../state/selection-store'
import { simulationActions } from '../state/simulation-store'
import { uiActions } from '../state/ui-store'
import type { StoryScene } from '../content/stories/types'
import { sceneAvailability } from './productAvailability'
import { availabilityActions } from '../state/availability-store'

export function storySceneAvailability(scene: StoryScene) {
  return sceneAvailability({ bodies: scene.bodies,
    ref: scene.referenceId, compareRef: scene.comparisonReferenceId,
    history: scene.historyDays, route: scene.route,
    layers: scene.showSpacecraft ? ['spacecraft'] : [],
  })
}

export function applyStoryScene(scene: StoryScene) {
  if (!availabilityActions.require(storySceneAvailability(scene))) return false
  availabilityActions.explorePreview()
  const selectedIds = scene.bodies.filter((id) => id !== 'sun')
  selectionActions.setSelectedIds(selectedIds)
  selectionActions.focus(scene.referenceId !== 'sun' ? scene.referenceId : selectedIds[0] ?? 'sun')
  simulationActions.patch({
    referenceId: scene.referenceId,
    comparisonReferenceId: scene.comparisonReferenceId ?? 'earth',
    comparisonEnabled: scene.comparisonEnabled ?? false,
    historyDays: scene.historyDays,
    viewMode: scene.view,
    viewOffset: { x: 0, y: 0 },
    zoom: 1,
    showEcliptic: true,
    showOrbits: false,
    showHillSphere: false,
    showLaplaceSoi: false,
    showLagrange: scene.showLagrange ?? false,
    showSpacecraft: scene.showSpacecraft ?? false,
  })
  if (scene.route === 'catalog' || scene.route === 'elements' || scene.filter || scene.aRange || scene.eRange || scene.qRange) {
    catalogActions.patchFilters({
      ...DEFAULT_CATALOG_FILTERS,
      ...(scene.filter ? { orbitClass: scene.filter } : {}),
      ...(scene.aRange ? { semiMajorAxis: scene.aRange } : {}),
      ...(scene.eRange ? { eccentricity: scene.eRange } : {}),
      ...(scene.qRange ? { perihelion: scene.qRange } : {}),
    })
  }
  if (scene.plot) uiActions.setElementPlot(scene.plot)
  simulationActions.seek(dateToJulianDay(new Date(`${scene.date}T12:00:00Z`)))
  uiActions.navigate(scene.route ?? 'explorer')
  return true
}
