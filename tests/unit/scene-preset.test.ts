import { describe, expect, it } from 'vitest'
import { SCENE_PRESETS } from '../../src/data/presets'
import { majorBodies, majorBodiesById } from '../../src/data/majorBodies'
import { buildScenePresetApplication, validateScenePresets } from '../../src/lib/scenePreset'

describe('observation-deck scene presets', () => {
  it('maps every built-in preset to a deterministic, bounded scene update', () => {
    expect(SCENE_PRESETS).toHaveLength(11)
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
        viewMode: preset.viewMode,
        zoom: preset.zoomLevel,
        viewOffset: { x: 0, y: 0 },
      })
    }
  })

  it('uses unique valid ids, existing bodies and complete bilingual copy', () => {
    expect(validateScenePresets(SCENE_PRESETS, majorBodiesById)).toEqual([])
    expect(new Set(SCENE_PRESETS.map((preset) => preset.id)).size).toBe(SCENE_PRESETS.length)
  })

  it('reports malformed preset ids, copy and body references', () => {
    const valid = SCENE_PRESETS[0]
    const issues = validateScenePresets([
      { ...valid, id: '', name: { en: '', zh: '' }, referenceId: 'missing-reference', selectedMajorBodyIds: ['missing-body', 'missing-body'] },
      { ...valid },
      { ...valid },
    ], majorBodiesById)

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid preset id'),
      expect.stringContaining('missing en name'),
      expect.stringContaining('missing zh name'),
      expect.stringContaining('unknown reference body'),
      expect.stringContaining('duplicate selected body id'),
      expect.stringContaining('unknown selected body'),
      expect.stringContaining('duplicate preset id'),
    ]))
  })

  it('offers honest first-batch body-centered modeled-moon scenes', () => {
    const expectedMoons = (parentId: string) => majorBodies
      .filter((body) => body.kind === 'moon' && body.parentId === parentId)
      .map((body) => body.id)

    const earth = SCENE_PRESETS.find((preset) => preset.id === 'earth-moon')!
    expect(earth.referenceId).toBe('earth')
    expect(earth.selectedMajorBodyIds).toEqual(['earth', ...expectedMoons('earth')])
    expect(earth.description.en).toContain('modeled moon')
    expect(earth.description.zh).toContain('已建模卫星')

    const jupiter = SCENE_PRESETS.find((preset) => preset.id === 'jupiter-galilean-moons')!
    expect(jupiter.referenceId).toBe('jupiter')
    expect(jupiter.selectedMajorBodyIds).toEqual(['jupiter', ...expectedMoons('jupiter')])
    expect(jupiter.viewMode).toBe('2d')
    expect(jupiter.description.en).toContain('modeled Galilean moons')
    expect(jupiter.description.zh).toContain('已建模伽利略卫星')

    const saturn = SCENE_PRESETS.find((preset) => preset.id === 'saturn-titan')!
    expect(saturn.referenceId).toBe('saturn')
    expect(saturn.selectedMajorBodyIds).toEqual(['saturn', ...expectedMoons('saturn')])
    expect(saturn.description.en).toContain('modeled moon')
    expect(saturn.description.zh).toContain('已建模卫星')
  })

  it('describes the Mars–Ceres–Jupiter preset as a corridor, not the full asteroid belt', () => {
    const corridor = SCENE_PRESETS.find((preset) => preset.id === 'mars-ceres-jupiter')!
    expect(corridor.referenceId).toBe('sun')
    expect(corridor.selectedMajorBodyIds).toEqual(['mars', 'ceres', 'jupiter'])
    expect(corridor.description.en).toContain('not the full asteroid belt')
    expect(corridor.description.zh).toContain('不代表完整小行星带')
  })

  it('focuses Earth when present and otherwise the first rendered body', () => {
    expect(buildScenePresetApplication(SCENE_PRESETS.find((preset) => preset.id === 'inner-system')!).focusedId).toBe('earth')
    expect(buildScenePresetApplication(SCENE_PRESETS.find((preset) => preset.id === 'outer-system')!).focusedId).toBe('jupiter')
  })
})
