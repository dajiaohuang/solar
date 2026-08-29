import { PRESET_DATASET_RELEASES, type ScenePreset, type ScenePresetCatalogSelection } from '../data/presets'
import type { SimulationState } from '../state/simulation-store'
import type { BodyId, CelestialBody } from '../types'
import type { AppUrlState } from './urlState'
import { CATALOG_ORBIT_CLASS_FILTERS } from './catalogFilters'

export type ScenePresetApplication = {
  julianDay: number
  selectedIds: BodyId[]
  focusedId: BodyId | null
  route: ScenePreset['route']
  elementPlot: ScenePreset['elementPlot']
  catalogSelection?: ScenePresetCatalogSelection
  simulation: Pick<SimulationState, 'referenceId' | 'comparisonEnabled' | 'historyDays' | 'viewMode' | 'zoom' | 'viewOffset'>
}

export function validateScenePresets(
  presets: ScenePreset[],
  bodiesById: Map<BodyId, CelestialBody>,
) {
  const issues: string[] = []
  const seenIds = new Set<string>()

  for (const [index, preset] of presets.entries()) {
    const label = preset.id || `preset at index ${index}`
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preset.id)) issues.push(`${label}: invalid preset id`)
    if (seenIds.has(preset.id)) issues.push(`${label}: duplicate preset id`)
    seenIds.add(preset.id)

    for (const language of ['en', 'zh'] as const) {
      if (!preset.name[language].trim()) issues.push(`${label}: missing ${language} name`)
      if (!preset.description[language].trim()) issues.push(`${label}: missing ${language} description`)
    }

    if (!bodiesById.has(preset.referenceId)) issues.push(`${label}: unknown reference body ${preset.referenceId}`)
    if (!preset.selectedMajorBodyIds.length) issues.push(`${label}: no selected bodies`)
    if (new Set(preset.selectedMajorBodyIds).size !== preset.selectedMajorBodyIds.length) issues.push(`${label}: duplicate selected body id`)
    for (const bodyId of preset.selectedMajorBodyIds) {
      if (!bodiesById.has(bodyId)) issues.push(`${label}: unknown selected body ${bodyId}`)
    }
    if (preset.catalogSelection) {
      const { datasetMode, datasetVersion, filters, sampleCount, sampleKind, sampleProfile } = preset.catalogSelection
      if (!/^[a-zA-Z0-9._-]+$/.test(datasetVersion)) issues.push(`${label}: invalid catalog dataset version`)
      const release = PRESET_DATASET_RELEASES[datasetVersion]
      if (!release) issues.push(`${label}: unavailable catalog dataset version`)
      if (!['lite', 'full'].includes(datasetMode)) issues.push(`${label}: invalid catalog dataset mode`)
      if (!['desktop', 'mobile'].includes(sampleProfile)) issues.push(`${label}: invalid catalog sample profile`)
      if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) issues.push(`${label}: invalid catalog sample count`)
      if (release && release.datasetMode !== datasetMode) issues.push(`${label}: catalog dataset mode mismatch`)
      if (release && ['desktop', 'mobile'].includes(sampleProfile)
        && release.samples[sampleProfile as keyof typeof release.samples] !== sampleCount) {
        issues.push(`${label}: catalog sample count mismatch`)
      }
      if (sampleKind !== 'display') issues.push(`${label}: invalid catalog sample kind`)
      if (!CATALOG_ORBIT_CLASS_FILTERS.includes(filters.orbitClass as typeof CATALOG_ORBIT_CLASS_FILTERS[number])) {
        issues.push(`${label}: unsupported catalog orbit class`)
      }
      if (!['all', 'known', 'unknown'].includes(filters.magnitudeStatus)) issues.push(`${label}: invalid magnitude status`)
      for (const [rangeName, range] of Object.entries({
        semiMajorAxis: filters.semiMajorAxis,
        eccentricity: filters.eccentricity,
        inclination: filters.inclination,
        absoluteMagnitude: filters.absoluteMagnitude,
        perihelion: filters.perihelion,
      })) {
        if (range.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1]) issues.push(`${label}: invalid ${rangeName} range`)
      }
      if (!['catalog', 'elements'].includes(preset.route ?? '')) issues.push(`${label}: catalog preset requires a catalog workspace route`)
    }
    if (preset.elementPlot && !['a-e', 'a-i', 'a-H', 'q-Q', 'a-period'].includes(preset.elementPlot)) issues.push(`${label}: invalid element plot`)
    if (preset.elementPlot && preset.route !== 'elements') issues.push(`${label}: element plot requires elements route`)
  }

  return issues
}

export function buildScenePresetApplication(preset: ScenePreset): ScenePresetApplication {
  const selectedIds = [...preset.selectedMajorBodyIds]
  return {
    julianDay: preset.julianDay,
    selectedIds,
    focusedId: selectedIds.includes('earth') ? 'earth' : selectedIds[0] ?? null,
    route: preset.route,
    elementPlot: preset.elementPlot,
    ...(preset.catalogSelection ? { catalogSelection: {
      ...preset.catalogSelection,
      filters: structuredClone(preset.catalogSelection.filters),
    } } : {}),
    simulation: {
      referenceId: preset.referenceId,
      comparisonEnabled: false,
      historyDays: preset.historyDays,
      viewMode: preset.viewMode,
      zoom: preset.zoomLevel,
      viewOffset: { x: 0, y: 0 },
    },
  }
}

export function buildScenePresetUrlState(preset: ScenePreset, lang: 'zh' | 'en'): AppUrlState {
  const catalog = preset.catalogSelection
  return {
    route: preset.route ?? 'explorer',
    ...(catalog ? {
      dataset: catalog.datasetVersion,
      mode: catalog.datasetMode,
      catalogSample: catalog.sampleProfile,
      catalogSampleCount: catalog.sampleCount,
      filter: catalog.filters.orbitClass,
      search: catalog.filters.query,
      aRange: [...catalog.filters.semiMajorAxis] as [number, number],
      eRange: [...catalog.filters.eccentricity] as [number, number],
      iRange: [...catalog.filters.inclination] as [number, number],
      hRange: [...catalog.filters.absoluteMagnitude] as [number, number],
      hStatus: catalog.filters.magnitudeStatus,
      qRange: [...catalog.filters.perihelion] as [number, number],
    } : {}),
    ref: preset.referenceId,
    bodies: [...preset.selectedMajorBodyIds],
    jd: preset.julianDay,
    zoom: preset.zoomLevel,
    history: preset.historyDays,
    view: preset.viewMode,
    preset: preset.id,
    plot: preset.elementPlot,
    lang,
  }
}
