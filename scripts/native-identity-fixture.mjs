// Synthetic native directory transport; never a scientific state or coverage oracle.
export function createNativeIdentityResponder() {
  let manifests = 0
  return (method, path) => {
    if (!path?.startsWith('/identity-fixture/')) return null
    const url = new URL(path, 'https://fixture.invalid')
    const manifest = { apiVersion: 'solar.api/v1', catalogVersion: 'identity-ui-fixture', catalogManifestSha256: 'a'.repeat(64), inventoryManifestSha256: 'b'.repeat(64) }
    if (method !== 'GET') return { status: 400, body: { error: 'No synthetic state requests are permitted' } }
    if (url.pathname === '/identity-fixture/v1/catalog/manifest') {
      // After two page reads, invalidate the selected page before any state plan.
      manifests++
      if (manifests >= 3) manifest.inventoryManifestSha256 = 'c'.repeat(64)
      return { status: 200, body: manifest }
    }
    if (url.pathname !== '/identity-fixture/v1/identities' || url.searchParams.get('limit') !== '50' || url.searchParams.get('q') !== '') return { status: 400, body: { error: 'Unexpected source query' } }
    const next = url.searchParams.get('pageToken') === 'next'
    return { status: 200, body: { ...manifest, sourceRecords: true, identityAssertions: true, uniqueBodySemantics: 'not-deduplicated', totalRecords: 100, limit: 50,
      items: Array.from({ length: 50 }, (_, i) => ({ id: `unknown:source:${(next ? 50 : 0) + i}`, name: `Synthetic source ${(next ? 50 : 0) + i}`,
        category: 'comet', source: 'synthetic-ui-only', sourceRow: i, identityStatus: 'source-designation', ephemerisStatus: 'unmapped' })), nextPageToken: next ? '' : 'next' } }
  }
}

export function verifyNativeIdentityTraffic(traffic) {
  const rows = traffic.filter(row => row.path?.startsWith('/identity-fixture/'))
  const expected = ['/identity-fixture/v1/catalog/manifest', '/identity-fixture/v1/identities?q=&limit=50',
    '/identity-fixture/v1/catalog/manifest', '/identity-fixture/v1/identities?q=&limit=50&pageToken=next',
    '/identity-fixture/v1/catalog/manifest']
  if (rows.length !== expected.length || rows.some((row, i) => row.method !== 'GET' || row.path !== expected[i] || row.status !== 200 || row.bytes < 1)) throw new Error('Identity UI did not prove explicit pages and rejection before state planning')
  return { scope: 'synthetic source UI, not astronomical data', requests: rows.length }
}
