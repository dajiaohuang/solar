// Synthetic UI transport cases only. Never forwarded as a real astronomy audit.
export function nativeCoverageFixture() {
  const hash = value => value.repeat(64)
  const manifest = { apiVersion: 'solar.api/v1', catalogVersion: 'coverage-fixture', catalogManifestSha256: hash('b'), inventoryManifestSha256: hash('c') }
  const summary = {
    ...manifest, purpose: 'source-identity-and-dependency-window-audit', profile: 'full', sourceBytesVerified: true,
    reportSha256: hash('a'), sourceSnapshotSha256: hash('d'), identityMappingSha256: hash('e'), satelliteCatalogSha256: hash('f'),
    auditEt: 500.125, timeScale: 'TDB seconds past J2000', frame: 'ECLIPJ2000',
    requestedWindow: { startEt: -20.5, endEt: 1000.25, timeScale: 'TDB seconds past J2000' },
    counts: { sourceRecords: 10, mappedSourceRecords: 3, unresolvedSourceRecords: 7, explicitNaifTargets: 2, availableTargetsAtAuditEpoch: 2 },
    windowCounts: { dependencyCoveredTargets: 1, targetsWithDependencyGaps: 1, numericallyCertifiedWholeWindowTargets: null },
    unresolvedReasons: { 'no-explicit-naif-mapping': 6, 'unresolved-component': 1 },
  }
  return { manifest, summary }
}

export function createNativeCoverageResponder() {
  let validRequests = 0
  return (method, path) => {
    if (!path?.startsWith('/coverage-fixture/')) return null
    const match = /^\/coverage-fixture\/(valid|invalid)\/v1\/(catalog\/manifest|coverage)$/.exec(path)
    if (method !== 'GET' || !match) return { status: 404, body: { error: 'synthetic_fixture_route_not_found' } }
    const { manifest, summary } = nativeCoverageFixture()
    if (match[2] === 'catalog/manifest') return { status: 200, body: manifest }
    if (match[1] === 'invalid') {
      summary.counts.unresolvedSourceRecords = 8
      return { status: 200, body: summary }
    }
    validRequests++
    return validRequests === 1 ? { status: 200, body: summary } : { status: 404, body: { error: 'coverage_unavailable' } }
  }
}

export function verifyNativeCoverageTraffic(traffic) {
  const rows = traffic.filter(row => row.path?.startsWith('/coverage-fixture/'))
  const expected = [
    ['/coverage-fixture/valid/v1/catalog/manifest', 200], ['/coverage-fixture/valid/v1/coverage', 200],
    ['/coverage-fixture/valid/v1/catalog/manifest', 200], ['/coverage-fixture/valid/v1/coverage', 404],
    ['/coverage-fixture/invalid/v1/catalog/manifest', 200], ['/coverage-fixture/invalid/v1/coverage', 200],
  ]
  if (rows.length !== expected.length || rows.some((row, index) => row.method !== 'GET' || row.path !== expected[index][0] || row.status !== expected[index][1] || row.bytes < 1)) {
    throw new Error('Synthetic native coverage traffic did not prove explicit load, fresh reload, unavailable and invalid cases')
  }
  return { scope: 'synthetic UI fixture, not astronomical coverage', requests: rows.length }
}
