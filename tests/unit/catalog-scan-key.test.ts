import { describe, expect, it } from 'vitest'
import { createCatalogScanKey, takeCatalogLocatorPage } from '../../src/lib/catalogScan'
import type { CatalogFilters } from '../../src/types'

const filters: CatalogFilters = {
  query: '',
  orbitClass: 'all',
  semiMajorAxis: [0, 80],
  eccentricity: [0, 0.999],
  inclination: [0, 180],
  absoluteMagnitude: [-5, 40],
  magnitudeStatus: 'all',
  perihelion: [0, 80],
}

describe('catalog scan identity', () => {
  it('binds a scan to dataset version, every filter, and sample budget', () => {
    const key = createCatalogScanKey('dataset-a', filters, 30_000)
    expect(createCatalogScanKey('dataset-a', structuredClone(filters), 30_000)).toBe(key)
    expect(createCatalogScanKey('dataset-b', filters, 30_000)).not.toBe(key)
    expect(createCatalogScanKey('dataset-a', { ...filters, query: 'Ceres' }, 30_000)).not.toBe(key)
    expect(createCatalogScanKey('dataset-a', filters, 8_000)).not.toBe(key)
  })
})

describe('catalog locator hydration pages', () => {
  it('bounds records and unique chunks while retaining later pages', () => {
    const locators = Uint32Array.from(Array.from({ length: 60 }, (_, index) => [index % 6, index]).flat())
    const first = takeCatalogLocatorPage(locators, 20, 3)
    expect(first.locators.length / 2).toBe(20)
    expect(new Set(Array.from(first.locators).filter((_, index) => index % 2 === 0)).size).toBeLessThanOrEqual(3)
    expect(first.remaining.length / 2).toBe(40)
    const second = takeCatalogLocatorPage(first.remaining, 20, 3)
    expect(second.locators.length / 2).toBe(20)
    expect(new Set(Array.from(second.locators).filter((_, index) => index % 2 === 0)).size).toBeLessThanOrEqual(3)
  })
})
