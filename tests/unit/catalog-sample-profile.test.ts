import { describe, expect, it } from 'vitest'
import { resolveCatalogSampleProfile } from '../../src/lib/catalogSampleProfile'
import type { AsteroidManifest, CatalogSampleProfile } from '../../src/types'

const manifest: AsteroidManifest = {
  schemaVersion: 3,
  version: 'mpcorb-fixture-full',
  datasetMode: 'full',
  source: 'fixture',
  generatedAt: '2026-08-29T00:00:00Z',
  totalCount: 30_000,
  chunkCount: 1,
  chunkSize: 5_000,
  bucketCounts: {},
  categoryCounts: {},
  featured: [],
  precomputedSamples: {
    desktop: {
      metadataPath: 'catalog-sample-desktop.json',
      binaryPath: 'catalog-sample-desktop.bin',
      count: 30_000,
    },
    mobile: {
      metadataPath: 'catalog-sample-mobile.json',
      binaryPath: 'catalog-sample-mobile.bin',
      count: 8_000,
    },
  },
}

function resolve(profile: string | null, count: number | null, viewport: CatalogSampleProfile, invalid = false) {
  return resolveCatalogSampleProfile(manifest, { profile, count, invalid }, viewport)
}

describe('catalog sample profile resolution', () => {
  it('pins an explicit profile independently of viewport size', () => {
    const desktop = resolve('mobile', 8_000, 'desktop')
    const mobile = resolve('mobile', 8_000, 'mobile')
    expect(desktop).toEqual(mobile)
    expect(desktop.sample).toMatchObject({
      profile: 'mobile',
      key: 'mpcorb-fixture-full:mobile:8000',
      pinned: true,
    })
  })

  it('preserves responsive selection only when no tuple was requested', () => {
    expect(resolve(null, null, 'desktop').sample?.profile).toBe('desktop')
    expect(resolve(null, null, 'mobile').sample?.profile).toBe('mobile')
  })

  it('fails closed for malformed, unsupported, unavailable, and mismatched requests', () => {
    expect(resolve('mobile', null, 'desktop').error).toEqual({ code: 'tuple-required' })
    expect(resolve('mobile', 8_000, 'desktop', true).error).toEqual({ code: 'tuple-required' })
    expect(resolveCatalogSampleProfile(
      manifest,
      { profile: 'mobile', count: null, countRaw: '8.5', invalid: true },
      'desktop',
    ).error).toEqual({ code: 'invalid-count', value: '8.5' })
    expect(resolve('tablet', 8_000, 'desktop').error).toEqual({ code: 'unsupported-profile', profile: 'tablet' })
    expect(resolve('mobile', 7_999, 'desktop').error).toMatchObject({ code: 'count-mismatch', requestedCount: 7_999 })
    expect(
      resolveCatalogSampleProfile(
        { ...manifest, precomputedSamples: undefined },
        { profile: 'mobile', count: 8_000, invalid: false },
        'desktop',
      ).error,
    ).toMatchObject({ code: 'profile-unavailable', profile: 'mobile' })
  })

  it('leaves legacy datasets without samples usable when no tuple was requested', () => {
    expect(
      resolveCatalogSampleProfile(
        { ...manifest, precomputedSamples: undefined },
        { profile: null, count: null, invalid: false },
        'desktop',
      ),
    ).toEqual({ sample: null, error: null })
  })
})
