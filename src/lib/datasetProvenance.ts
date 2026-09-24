import type { AsteroidManifest, DatasetProvenance } from '../types'

/** Compare declared metadata. This does not hash source or artifact bytes. */
export function bindDatasetProvenance(report: DatasetProvenance, manifest: AsteroidManifest): DatasetProvenance {
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
      report.datasetVersion !== manifest.version || report.source !== manifest.source ||
      !Number.isSafeInteger(report.totalObjects) || report.totalObjects < 0 || report.totalObjects !== manifest.totalCount ||
      !['lite', 'full'].includes(report.mode) || manifest.datasetMode !== undefined && report.mode !== manifest.datasetMode ||
      report.generatedAt !== manifest.generatedAt) throw new Error('Dataset provenance identity/count/mode does not match its manifest')
  for (const value of [report.parserVersion, report.orbitModel, report.precision]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Dataset provenance lacks parser/model/precision declarations')
  }
  if (typeof report.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(report.sourceSha256) ||
      report.contentSha256 !== undefined && (typeof report.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(report.contentSha256))) {
    throw new Error('Dataset provenance contains invalid hash declarations')
  }
  const fields = ['sourceSha256', 'contentSha256', 'parserVersion', 'parserCommit', 'orbitModel', 'precision', 'sourceLastModifiedAt'] as const
  for (const field of fields) {
    if (manifest[field] !== undefined && report[field] !== manifest[field]) throw new Error(`Dataset provenance ${field} does not match its manifest`)
  }
  if (manifest.sourceDownloadedAt !== undefined && report.downloadedAt !== manifest.sourceDownloadedAt) throw new Error('Dataset provenance download timestamp does not match its manifest')
  if (manifest.selectionPolicy !== undefined) {
    const expected = manifest.selectionPolicy, actual = report.selectionPolicy
    if (!actual || actual.type !== expected.type || actual.maxPermanentNumber !== expected.maxPermanentNumber ||
        !Array.isArray(actual.requiredFeaturedNames) || actual.requiredFeaturedNames.length !== expected.requiredFeaturedNames.length ||
        actual.requiredFeaturedNames.some((name, index) => name !== expected.requiredFeaturedNames[index])) {
      throw new Error('Dataset provenance selection policy does not match its manifest')
    }
  }
  return { ...report, recordOrigin: 'provenance-file' }
}

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
