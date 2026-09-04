import preview from '../../src/data/preview-profile.json' with { type: 'json' }

/** Explicit allowlist: adding a future full artifact cannot leak it to preview. */
export function previewDatasetPlan(source, availabilitySha256) {
  const sample = source.precomputedSamples?.mobile
  if (sample?.count !== preview.catalog.sampleCount
    || sample.metadataPath !== 'catalog-sample-mobile.json'
    || sample.binaryPath !== 'catalog-sample-mobile.bin') throw new Error('Preview requires the pinned mobile display sample')
  if (source.summaryPath !== 'catalog-summary.json') throw new Error('Unexpected preview summary path')
  const keys = ['schemaVersion', 'version', 'datasetMode', 'source', 'generatedAt', 'sourceLastModifiedAt',
    'sourceDownloadedAt', 'sourceSha256', 'contentSha256', 'parserVersion', 'parserCommit',
    'selectionPolicy', 'orbitModel', 'precision', 'totalCount', 'categoryCounts']
  const manifest = Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, structuredClone(source[key])]))
  Object.assign(manifest, {
    capabilities: ['precomputed-samples-v1', 'catalog-summary-v1', 'gzip-json-v1', 'preview-display-only-v1'],
    chunkCount: 0, chunkSize: 0, lookupBucketCount: 0, bucketCounts: {}, featured: [],
    precomputedSamples: { mobile: structuredClone(sample) }, summaryPath: source.summaryPath,
    delivery: {
      profile: 'preview', availabilitySha256,
      sourceTotalCount: source.totalCount, deliveredSampleCount: sample.count,
      meaning: 'Curated display sample; source totals and validation describe the source dataset, not delivered coverage.',
      jsonCompression: 'gzip', suffix: '.gz', compressedDirectories: [],
      compressedRootArtifacts: [sample.metadataPath],
    },
  })
  return { manifest, sourcePaths: [
    'manifest.json', 'provenance.json', 'validation-report.json', source.summaryPath,
    sample.metadataPath, sample.binaryPath,
  ] }
}
