import { describe, expect, it } from 'vitest'
import { productDelivery, jsonDocument, sha256 } from '../../scripts/lib/product-delivery'
// Build helper is deliberately executable directly by Node, without a bundler.
// @ts-expect-error Build-only JavaScript helper has no declaration file.
import { previewDatasetPlan } from '../../scripts/lib/preview-dataset.mjs'

const source = {
  schemaVersion: 3, version: 'fixture', source: 'fixture-not-scientific-data', totalCount: 1_500_000,
  contentSha256: 'source-hash', sourceSha256: 'original-file-hash', datasetMode: 'full',
  summaryPath: 'catalog-summary.json', categoryCounts: { MBA: 1_000_000 },
  precomputedSamples: {
    desktop: { count: 30000, metadataPath: 'catalog-sample-desktop.json', binaryPath: 'catalog-sample-desktop.bin' },
    mobile: { count: 8000, metadataPath: 'catalog-sample-mobile.json', binaryPath: 'catalog-sample-mobile.bin' },
  },
  searchIndex: { locators: true }, compactIndex: { path: 'catalog-index.bin' },
  capabilities: ['catalog-index-v1'], futureFullArtifact: 'large-download.bin',
}

describe('physical preview artifact policy', () => {
  it('separates product identity, coefficient profile and immutable full/preview cache URLs', () => {
    const full = productDelivery(), preview = productDelivery('preview')
    expect(full.product).toBe('full')
    expect(full.catalogDirectory).toBe('data/asteroids')
    expect(preview.catalogDirectory).toBe(`data/asteroids/preview/${preview.availabilitySha256}`)
    expect(preview.availabilitySha256).toBe(sha256(jsonDocument(preview.availability)))
    expect(productDelivery('full', 'full').scientificProfile).toBe('full')
  })
  it('publishes only mobile sample and source evidence without advertising full resources', () => {
    const before = JSON.stringify(source)
    const plan = previewDatasetPlan(source, 'availability-hash')
    expect(plan.sourcePaths).toEqual(['manifest.json', 'provenance.json', 'validation-report.json', 'catalog-summary.json', 'catalog-sample-mobile.json', 'catalog-sample-mobile.bin'])
    expect(plan.manifest.totalCount).toBe(1_500_000)
    expect(plan.manifest.contentSha256).toBe('source-hash')
    expect(plan.manifest.delivery.deliveredSampleCount).toBe(8000)
    expect(plan.manifest.precomputedSamples.desktop).toBeUndefined()
    expect(plan.manifest.compactIndex).toBeUndefined()
    expect(plan.manifest.searchIndex).toBeUndefined()
    expect(plan.manifest.futureFullArtifact).toBeUndefined()
    expect(plan.manifest.chunkCount).toBe(0)
    expect(JSON.stringify(source)).toBe(before)
  })
  it('rejects alternate paths and counts before copying files', () => {
    for (const replacement of [{ count: 7999 }, { metadataPath: '../escape.json' }, { binaryPath: 'binary/full.bin' }]) {
      const invalid = structuredClone(source)
      Object.assign(invalid.precomputedSamples.mobile, replacement)
      expect(() => previewDatasetPlan(invalid, 'hash')).toThrow(/pinned mobile/)
    }
  })
})
