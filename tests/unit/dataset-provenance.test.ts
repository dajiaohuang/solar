import { describe, expect, it } from 'vitest'
import { datasetDisplayTimestamps } from '../../src/lib/datasetProvenance'

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
