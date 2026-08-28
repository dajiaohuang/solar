import { describe, expect, it } from 'vitest'
import { SCENE_PRESETS } from '../../src/data/presets'
import { buildScenePresetApplication } from '../../src/lib/scenePreset'

describe('observation-deck scene presets', () => {
  it('maps every built-in preset to a deterministic, bounded scene update', () => {
    expect(SCENE_PRESETS).toHaveLength(8)
    for (const preset of SCENE_PRESETS) {
      const application = buildScenePresetApplication(preset)
      expect(application.julianDay).toBe(preset.julianDay)
      expect(application.selectedIds).toEqual(preset.selectedMajorBodyIds)
      expect(application.selectedIds).not.toBe(preset.selectedMajorBodyIds)
      expect(application.selectedIds.length).toBeGreaterThan(0)
      expect(application.simulation).toEqual({
        referenceId: preset.referenceId,
        comparisonEnabled: false,
        historyDays: preset.historyDays,
        zoom: preset.zoomLevel,
        viewOffset: { x: 0, y: 0 },
      })
    }
  })

  it('focuses Earth when present and otherwise the first rendered body', () => {
    expect(buildScenePresetApplication(SCENE_PRESETS.find((preset) => preset.id === 'inner-system')!).focusedId).toBe('earth')
    expect(buildScenePresetApplication(SCENE_PRESETS.find((preset) => preset.id === 'outer-system')!).focusedId).toBe('jupiter')
  })
})
