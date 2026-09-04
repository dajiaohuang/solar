import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AsteroidManifest, CelestialBody } from '../../src/types'

beforeEach(() => { vi.resetModules(); vi.stubGlobal('__SOLAR_PRODUCT_PROFILE__', 'preview') })
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('preview rejects complete operations before scientific side effects', () => {
  it('guards selection, focus, catalog insertion, reference and route mutations', async () => {
    const { selectionActions, selectionStore } = await import('../../src/state/selection-store')
    const { simulationActions, simulationStore } = await import('../../src/state/simulation-store')
    const { uiActions, uiStore } = await import('../../src/state/ui-store')
    const selected = selectionStore.getState(), simulated = simulationStore.getState(), ui = uiStore.getState()
    const id = 'naif:65297'
    expect(selectionActions.setSelectedIds(['earth', id])).toBe(false)
    selectionActions.toggle(id)
    selectionActions.focus(id)
    selectionActions.addCatalogBodies([{ id, name: 'Restricted test body' } as CelestialBody], true)
    simulationActions.patch({ referenceId: id, zoom: 5 })
    uiActions.navigate('mission')
    uiActions.startStory('voyagers')
    expect(selectionStore.getState()).toBe(selected)
    expect(simulationStore.getState()).toBe(simulated)
    expect(uiStore.getState()).toBe(ui)
    selectionActions.setSelectedIds(['earth', 'moon'])
    expect(selectionStore.getState().selectedIds).toEqual(['earth', 'moon'])
  })

  it('does not mutate half a denied story scene', async () => {
    const { applyStoryScene } = await import('../../src/lib/storyScene')
    const { selectionStore } = await import('../../src/state/selection-store')
    const { simulationStore } = await import('../../src/state/simulation-store')
    const beforeSelection = selectionStore.getState(), beforeSimulation = simulationStore.getState()
    expect(applyStoryScene({ date: '2026-09-04', bodies: ['earth'], referenceId: 'sun', view: '3d', historyDays: 365, route: 'mission' })).toBe(false)
    expect(selectionStore.getState()).toBe(beforeSelection)
    expect(simulationStore.getState()).toBe(beforeSimulation)
  })

  it('starts no network request or worker for full catalog/SBDB operations', async () => {
    const fetch = vi.fn(), worker = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('Worker', worker)
    const loaders = await import('../../src/lib/catalogLoader')
    const { scanAsteroidCatalog } = await import('../../src/lib/catalogScan')
    const { fetchSbdbBody } = await import('../../src/data/loaders/sbdb')
    const { DEFAULT_CATALOG_FILTERS } = await import('../../src/state/catalog-store')
    const manifest = { version: 'test', precomputedSamples: { desktop: { count: 30000 } } } as AsteroidManifest
    expect(() => loaders.loadAsteroidSearchBucket('ce')).toThrow(/preview/)
    expect(() => loaders.loadAsteroidChunk('chunk-0000')).toThrow(/preview/)
    await expect(loaders.loadAsteroidBodiesByIds(['asteroid:123456'])).rejects.toThrow(/preview/)
    await expect(loaders.loadAsteroidRecordsByLocators(manifest, new Uint32Array([0, 0]))).rejects.toThrow(/preview/)
    await expect(loaders.loadAsteroidManifest('another-release')).rejects.toThrow(/preview/)
    await expect(loaders.loadAsteroidSample(manifest, 'desktop')).rejects.toThrow(/preview/)
    await expect(fetchSbdbBody('Ceres')).rejects.toThrow(/preview/)
    await expect(scanAsteroidCatalog({ manifest, filters: DEFAULT_CATALOG_FILTERS, sampleLimit: 100 })).rejects.toThrow(/preview/)
    expect(fetch).not.toHaveBeenCalled()
    expect(worker).not.toHaveBeenCalled()
  })

  it('does not silently clamp an explicit larger sample to the curated sample', async () => {
    const { sceneAvailability } = await import('../../src/lib/productAvailability')
    const request = { catalogSample: 'desktop', catalogSampleCount: 30000 }
    expect(sceneAvailability(request).available).toBe(false)
    expect(request).toEqual({ catalogSample: 'desktop', catalogSampleCount: 30000 })
  })

  it('keeps the original denied URL across later controls and replaces it only on a new URL request', async () => {
    const { availabilityActions, availabilityStore } = await import('../../src/state/availability-store')
    const { bodyAvailability } = await import('../../src/lib/productAvailability')
    const denial = bodyAvailability('naif:65297')
    availabilityActions.require(denial, 'https://example.invalid/solar/?first#unchanged')
    availabilityActions.dismiss()
    availabilityActions.require(denial)
    expect(availabilityStore.getState().requestedSceneUrl).toBe('https://example.invalid/solar/?first#unchanged')
    expect(availabilityStore.getState().preserveLocation).toBe(true)
    availabilityActions.require(denial, 'https://example.invalid/solar/?second')
    expect(availabilityStore.getState().requestedSceneUrl).toBe('https://example.invalid/solar/?second')
    availabilityActions.explorePreview()
    expect(availabilityStore.getState().preserveLocation).toBe(false)
    expect(availabilityStore.getState().requestedSceneUrl).toBe('https://example.invalid/solar/?second')
  })

  it('permits unchanged full-profile state actions', async () => {
    vi.stubGlobal('__SOLAR_PRODUCT_PROFILE__', 'full')
    const { selectionActions, selectionStore } = await import('../../src/state/selection-store')
    const { simulationActions, simulationStore } = await import('../../src/state/simulation-store')
    const { uiActions, uiStore } = await import('../../src/state/ui-store')
    selectionActions.setSelectedIds(['earth', 'naif:65297'])
    simulationActions.patch({ referenceId: 'naif:65297', historyDays: 12053 })
    uiActions.navigate('mission')
    expect(selectionStore.getState().selectedIds).toContain('naif:65297')
    expect(simulationStore.getState().referenceId).toBe('naif:65297')
    expect(uiStore.getState().route).toBe('mission')
  })
})
