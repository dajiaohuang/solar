import { describe, expect, it } from 'vitest'
import datasetPin from '../../.github/asteroid-dataset.json'
import { SCENE_PRESETS } from '../../src/data/presets'
import { majorBodies, majorBodiesById } from '../../src/data/majorBodies'
import { buildScenePresetApplication, buildScenePresetUrlState, validateScenePresets } from '../../src/lib/scenePreset'
import { decodeUrlState, encodeUrlState } from '../../src/lib/urlState'

describe('observation-deck scene presets', () => {
  it('maps every built-in preset to a deterministic, bounded scene update', () => {
    expect(SCENE_PRESETS).toHaveLength(22)
    for (const preset of SCENE_PRESETS) {
      const application = buildScenePresetApplication(preset)
      expect(application.julianDay).toBe(preset.julianDay)
      expect(application.selectedIds).toEqual(preset.selectedMajorBodyIds)
      expect(application.selectedIds).not.toBe(preset.selectedMajorBodyIds)
      if (preset.catalogSelection) {
        expect(application.catalogSelection).toEqual(preset.catalogSelection)
        expect(application.catalogSelection).not.toBe(preset.catalogSelection)
        expect(application.catalogSelection?.filters).not.toBe(preset.catalogSelection.filters)
      }
      expect(application.route).toBe(preset.route)
      expect(application.elementPlot).toBe(preset.elementPlot)
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
    expect(SCENE_PRESETS.every((preset) => preset.viewMode === '3d')).toBe(true)
  })

  it('reports malformed preset ids, copy and body references', () => {
    const valid = SCENE_PRESETS[0]
    const beltSelection = SCENE_PRESETS.find((preset) => preset.id === 'mars-main-belt-jupiter')!.catalogSelection!
    const issues = validateScenePresets([
      {
        ...valid,
        id: '',
        name: { en: '', zh: '' },
        referenceId: 'missing-reference',
        selectedMajorBodyIds: ['missing-body', 'missing-body'],
        catalogSelection: {
          ...beltSelection,
          datasetVersion: '../unsafe',
          datasetMode: 'archive' as never,
          sampleProfile: 'tablet' as never,
          sampleCount: 0,
          sampleKind: 'selection' as never,
          filters: { ...beltSelection.filters, orbitClass: 'UNSUPPORTED', magnitudeStatus: 'maybe' as never, semiMajorAxis: [3, 2] },
        },
      },
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
      expect.stringContaining('invalid catalog dataset version'),
      expect.stringContaining('invalid catalog dataset mode'),
      expect.stringContaining('invalid catalog sample profile'),
      expect.stringContaining('invalid catalog sample count'),
      expect.stringContaining('invalid catalog sample kind'),
      expect.stringContaining('unsupported catalog orbit class'),
      expect.stringContaining('invalid magnitude status'),
      expect.stringContaining('invalid semiMajorAxis range'),
      expect.stringContaining('catalog preset requires a catalog workspace route'),
      expect.stringContaining('duplicate preset id'),
    ]))

    const unavailable = SCENE_PRESETS.find((preset) => preset.id === 'mars-main-belt-jupiter')!
    expect(validateScenePresets([{
      ...unavailable,
      catalogSelection: { ...unavailable.catalogSelection!, datasetVersion: 'missing-release-v1' },
    }], majorBodiesById)).toContain('mars-main-belt-jupiter: unavailable catalog dataset version')
    expect(validateScenePresets([{
      ...unavailable,
      catalogSelection: { ...unavailable.catalogSelection!, datasetMode: 'lite', sampleCount: 7_999 },
    }], majorBodiesById)).toEqual(expect.arrayContaining([
      'mars-main-belt-jupiter: catalog dataset mode mismatch',
      'mars-main-belt-jupiter: catalog sample count mismatch',
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
    expect(jupiter.selectedMajorBodyIds).toEqual(['jupiter', 'io', 'europa', 'ganymede', 'callisto'])
    expect(jupiter.viewMode).toBe('3d')
    expect(jupiter.description.en).toContain('modeled Galilean moons')
    expect(jupiter.description.zh).toContain('已建模伽利略卫星')

    const saturn = SCENE_PRESETS.find((preset) => preset.id === 'saturn-titan')!
    expect(saturn.referenceId).toBe('saturn')
    expect(saturn.selectedMajorBodyIds).toEqual(['saturn', 'titan'])
    expect(saturn.description.en).toContain('modeled moon')
    expect(saturn.description.zh).toContain('已建模卫星')
  })

  it('defines a bounded, viewport-independent main-belt catalog selection', () => {
    for (const parent of ['mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']) {
      const preset = SCENE_PRESETS.find((item) => item.id === `${parent}-spk-moons`)!
      expect(preset.selectedMajorBodyIds).toEqual([parent, ...majorBodies.filter((body) => body.kind === 'moon' && body.parentId === parent).slice(0, 159).map((body) => body.id)])
      expect(preset.viewMode).toBe('3d')
    }
    const belt = SCENE_PRESETS.find((preset) => preset.id === 'mars-main-belt-jupiter')!
    expect(belt.referenceId).toBe('sun')
    expect(belt.selectedMajorBodyIds).toEqual(['mars', 'ceres', 'jupiter'])
    expect(belt.catalogSelection).toMatchObject({
      datasetVersion: datasetPin.version,
      datasetMode: 'full',
      sampleProfile: 'mobile',
      sampleCount: 8_000,
      sampleKind: 'display',
      filters: { orbitClass: 'MBA' },
    })
    expect(belt.route).toBe('elements')
    expect(belt.elementPlot).toBe('a-e')
    expect(belt.description.en).toContain('display sample')
    expect(belt.description.zh).toContain('展示样本')

    const comparison = SCENE_PRESETS.find((preset) => preset.id === 'main-belt-elements')!
    expect(comparison.route).toBe('elements')
    expect(comparison.elementPlot).toBe('a-i')
    expect(comparison.catalogSelection).toMatchObject({
      datasetVersion: belt.catalogSelection!.datasetVersion,
      sampleProfile: 'mobile',
      sampleCount: 8_000,
      filters: { orbitClass: 'MBA' },
    })

    for (const preset of [belt, comparison]) {
      const urlState = buildScenePresetUrlState(preset, 'en')
      expect(urlState.ref).toBe('sun')
      const encoded = encodeUrlState(urlState)
      expect(decodeUrlState(`?${encoded}`)).toMatchObject({
        version: 4,
        route: 'elements',
        dataset: datasetPin.version,
        mode: 'full',
        catalogSample: 'mobile',
        catalogSampleCount: 8_000,
        filter: 'MBA',
        bodies: ['mars', 'ceres', 'jupiter'],
        preset: preset.id,
        plot: preset.elementPlot,
        lang: 'en',
      })
    }
  })

  it('focuses Earth when present and otherwise the first rendered body', () => {
    expect(buildScenePresetApplication(SCENE_PRESETS.find((preset) => preset.id === 'inner-system')!).focusedId).toBe('earth')
    expect(buildScenePresetApplication(SCENE_PRESETS.find((preset) => preset.id === 'outer-system')!).focusedId).toBe('jupiter')
  })
})
