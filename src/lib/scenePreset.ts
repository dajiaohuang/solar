import type { ScenePreset } from '../data/presets'
import type { SimulationState } from '../state/simulation-store'
import type { BodyId } from '../types'

export type ScenePresetApplication = {
  julianDay: number
  selectedIds: BodyId[]
  focusedId: BodyId | null
  simulation: Pick<SimulationState, 'referenceId' | 'comparisonEnabled' | 'historyDays' | 'zoom' | 'viewOffset'>
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
      zoom: preset.zoomLevel,
      viewOffset: { x: 0, y: 0 },
    },
  }
}
