// Deliberately synthetic counts: tests do not claim additional astronomy data.
export function coverageSummaryFixture() {
  return {
    apiVersion: 'solar.api/v1', purpose: 'source-identity-and-dependency-window-audit',
    reportSha256: 'a'.repeat(64), catalogVersion: 'coverage-fixture',
    catalogManifestSha256: 'b'.repeat(64), inventoryManifestSha256: 'c'.repeat(64),
    sourceSnapshotSha256: 'd'.repeat(64), identityMappingSha256: 'e'.repeat(64), satelliteCatalogSha256: 'f'.repeat(64),
    sourceBytesVerified: true, profile: 'full', auditEt: 500,
    timeScale: 'TDB seconds past J2000', frame: 'ECLIPJ2000',
    requestedWindow: { startEt: 0, endEt: 1000, timeScale: 'TDB seconds past J2000' },
    counts: { sourceRecords: 10, mappedSourceRecords: 3, unresolvedSourceRecords: 7, explicitNaifTargets: 2, availableTargetsAtAuditEpoch: 2 },
    windowCounts: { dependencyCoveredTargets: 1, targetsWithDependencyGaps: 1, numericallyCertifiedWholeWindowTargets: null },
    unresolvedReasons: { 'no-explicit-naif-mapping': 6, 'unresolved-component': 1 },
  }
}
