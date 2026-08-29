import type { ScenePreset } from '../data/presets'
import type { SimulationState } from '../state/simulation-store'
import type { BodyId, CelestialBody } from '../types'

export type ScenePresetApplication = {
  julianDay: number
  selectedIds: BodyId[]
  focusedId: BodyId | null
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
  }

  return issues
}

export function buildScenePresetApplication(preset: ScenePreset): ScenePresetApplication {
  const selectedIds = [...preset.selectedMajorBodyIds]
  return {
    julianDay: preset.julianDay,
    selectedIds,
    focusedId: selectedIds.includes('earth') ? 'earth' : selectedIds[0] ?? null,
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
