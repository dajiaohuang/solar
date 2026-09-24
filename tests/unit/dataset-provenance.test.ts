import { describe, expect, it } from 'vitest'
import { bindDatasetProvenance, datasetDisplayTimestamps } from '../../src/lib/datasetProvenance'
import type { AsteroidManifest, DatasetProvenance } from '../../src/types'

describe('dataset provenance binding', () => {
  const manifest = { version: 'source-v1', source: 'MPC', generatedAt: '2026-09-01T00:00:00Z',
    totalCount: 1, datasetMode: 'full', sourceSha256: 'a'.repeat(64), contentSha256: 'b'.repeat(64),
    parserVersion: '1', orbitModel: 'two-body', precision: 'source elements',
    selectionPolicy: { type: 'all-valid-elliptic', requiredFeaturedNames: [] } } as AsteroidManifest
  const report: DatasetProvenance = { datasetVersion: manifest.version, source: manifest.source,
    generatedAt: manifest.generatedAt, totalObjects: 1, mode: 'full', sourceSha256: manifest.sourceSha256!,
    contentSha256: manifest.contentSha256, parserVersion: '1', orbitModel: 'two-body', precision: 'source elements',
    selectionPolicy: manifest.selectionPolicy }

  it('classifies the fetched record locally after matching its manifest', () => {
    expect(bindDatasetProvenance({ ...report, recordOrigin: 'manifest-derived' }, manifest))
      .toMatchObject({ datasetVersion: 'source-v1', recordOrigin: 'provenance-file' })
  })

  it('rejects mismatched identities, counts, scientific declarations and selection policy', () => {
    for (const patch of [{ datasetVersion: 'other' }, { totalObjects: 2 }, { sourceSha256: 'c'.repeat(64) },
      { orbitModel: 'different model' }, { precision: '' }, { parserVersion: '2' },
      { selectionPolicy: { ...report.selectionPolicy!, requiredFeaturedNames: ['ceres'] } }]) {
      expect(() => bindDatasetProvenance({ ...report, ...patch }, manifest)).toThrow()
    }
  })
})

describe('dataset provenance display timestamps', () => {
  it('separates new source Last-Modified and generation timestamps', () => {
    expect(datasetDisplayTimestamps({
      sourceLastModifiedAt: '2026-08-18T00:00:00.000Z',
      generatedAt: '2026-08-20T12:34:56.000Z',
    })).toEqual({
      sourceLastModifiedAt: '2026-08-18T00:00:00.000Z',
      generatedAt: '2026-08-20T12:34:56.000Z',
    })
  })

  it('preserves distinct generation evidence in legacy schema-v3 releases', () => {
    expect(datasetDisplayTimestamps({
      sourceDownloadedAt: '2026-08-19T06:58:26.289Z',
      generatedAt: '2026-08-19T18:22:18.349Z',
    })).toEqual({
      sourceLastModifiedAt: '2026-08-19T06:58:26.289Z',
      generatedAt: '2026-08-19T18:22:18.349Z',
    })
  })

  it('does not relabel a legacy conflated timestamp as generation evidence', () => {
    const timestamp = '2026-08-19T06:58:26.289Z'
    expect(datasetDisplayTimestamps({ sourceDownloadedAt: timestamp, generatedAt: timestamp })).toEqual({
      sourceLastModifiedAt: timestamp,
      generatedAt: undefined,
    })
    expect(datasetDisplayTimestamps({ generatedAt: timestamp })).toEqual({
      sourceLastModifiedAt: timestamp,
      generatedAt: undefined,
    })
  })
})
