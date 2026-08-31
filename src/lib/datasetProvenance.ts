import type { AsteroidManifest } from '../types'

type DatasetTimestamps = Pick<AsteroidManifest, 'generatedAt' | 'sourceLastModifiedAt' | 'sourceDownloadedAt'>

export function datasetDisplayTimestamps(timestamps: DatasetTimestamps) {
  const sourceLastModifiedAt = timestamps.sourceLastModifiedAt ??
    timestamps.sourceDownloadedAt ??
    timestamps.generatedAt
  const generatedAt = timestamps.sourceLastModifiedAt
    ? timestamps.generatedAt
    : timestamps.sourceDownloadedAt && timestamps.generatedAt !== timestamps.sourceDownloadedAt
      ? timestamps.generatedAt
      : undefined
  return { sourceLastModifiedAt, generatedAt }
}
