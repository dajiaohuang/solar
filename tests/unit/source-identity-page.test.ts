import { describe, expect, it, vi } from 'vitest'
import { inspectSourceIdentityPage, loadSourceIdentityPage, validateSourceIdentityPage } from '../../src/lib/sourceIdentityPage'
import type { StateTileManifest } from '../../src/lib/stateTiles'

const manifest: StateTileManifest = { apiVersion: 'solar.api/v1', catalogVersion: 'test', catalogManifestSha256: 'a'.repeat(64), inventoryManifestSha256: 'b'.repeat(64) }
const row = { id: 'sb:comet:1P', name: 'Halley', category: 'comet', source: 'test-source', sourceRow: 1, identityStatus: 'source-designation', ephemerisStatus: 'not-mapped-to-bundled-kernel', naifId: 1000036 }
function raw() { return { ...manifest, sourceRecords: true, identityAssertions: true, uniqueBodySemantics: 'not-deduplicated', totalRecords: 100, limit: 50, items: [row], nextPageToken: 'next' } }
function json(value: unknown) {
  const body = JSON.stringify(value)
  return new Response(body, { headers: { 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(body).length) } })
}
const request = () => ({ base: 'https://fixture.invalid', profile: 'full' as const, signal: new AbortController().signal, query: '' })

describe('bounded all-source directory', () => {
  it('preserves a source identity instead of inferring a target or a physical state', () => {
    const page = validateSourceIdentityPage(raw(), manifest)
    expect(page.items[0].id).toBe('sb:comet:1P')
    expect(page.items[0].ephemerisStatus).toBe('not-mapped-to-bundled-kernel')
    expect(page.totalRecords).toBe(100)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).not.toHaveProperty('states')
  })
  it('rejects false counts, duplicate IDs, unsafe strings, large pages and stale manifest bindings', () => {
    const cases = [
      { totalRecords: -1 }, { totalRecords: 0 }, { limit: 500 }, { sourceRecords: false },
      { uniqueBodySemantics: 'unique-bodies' }, { inventoryManifestSha256: 'c'.repeat(64) },
      { items: [row, row] }, { items: Array(51).fill(row) }, { items: [{ ...row, id: 'bad\nID' }] },
      { items: [{ ...row, sourceRow: 1.5 }] }, { items: [], nextPageToken: 'next' },
    ]
    for (const change of cases) expect(() => validateSourceIdentityPage({ ...raw(), ...change }, manifest)).toThrow()
  })
  it('blocks preview, missing backend and prior cancellation before any request', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(loadSourceIdentityPage({ ...request(), profile: 'preview', fetcher })).rejects.toThrow()
    await expect(loadSourceIdentityPage({ ...request(), base: null, fetcher })).rejects.toThrow()
    await expect(loadSourceIdentityPage({ ...request(), signal: AbortSignal.abort(), fetcher })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('fetches one bounded page and pins its cursor to the exact query and dataset', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(manifest)).mockResolvedValueOnce(json(raw()))
    const page = await loadSourceIdentityPage({ ...request(), query: 'Halley', fetcher })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[1][0])).toContain('limit=50')
    await expect(loadSourceIdentityPage({ ...request(), previous: page, fetcher })).rejects.toThrow('another query')
    fetcher.mockResolvedValueOnce(json({ ...manifest, inventoryManifestSha256: 'c'.repeat(64) }))
    await expect(loadSourceIdentityPage({ ...request(), query: 'Halley', previous: page, fetcher })).rejects.toThrow('changed')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('rejects oversized delivery and repeated cursors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(manifest)).mockResolvedValueOnce(new Response('{}', { headers: { 'content-length': String(256 * 1024 + 1) } }))
    await expect(loadSourceIdentityPage({ ...request(), fetcher })).rejects.toThrow('byte budget')
    const page = { ...validateSourceIdentityPage(raw(), manifest), query: '' }
    fetcher.mockResolvedValueOnce(json(manifest)).mockResolvedValueOnce(json(raw()))
    await expect(loadSourceIdentityPage({ ...request(), previous: page, fetcher })).rejects.toThrow('did not advance')
  })
  it('does not issue a state plan after inventory drift, invalid epoch or preview restriction', async () => {
    const page = { ...validateSourceIdentityPage(raw(), manifest), query: '' }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...manifest, inventoryManifestSha256: 'c'.repeat(64) }))
    await expect(inspectSourceIdentityPage({ ...request(), page, epochTdbJd: NaN, fetcher })).rejects.toThrow()
    await expect(inspectSourceIdentityPage({ ...request(), page, epochTdbJd: 2461287.5, profile: 'preview', fetcher })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
    await expect(inspectSourceIdentityPage({ ...request(), page, epochTdbJd: 2461287.5, fetcher })).rejects.toThrow('changed')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

const liveBase = process.env.SOLAR_IDENTITY_API_BASE_URL
it.skipIf(!liveBase)('browses real full-source pages and checks their exact/missing tiles without registry substitution', async () => {
  const params = { ...request(), base: liveBase!, signal: AbortSignal.timeout(90_000) }
  const first = await loadSourceIdentityPage(params)
  expect(first.items).toHaveLength(50)
  const next = await loadSourceIdentityPage({ ...params, previous: first })
  expect(next.items).toHaveLength(50)
  expect(next.items.some(row => first.items.some(prior => prior.id === row.id))).toBe(false)
  const result = await inspectSourceIdentityPage({ ...params, page: first, epochTdbJd: 2461287.5 })
  expect(result.plan.requestIds).toEqual(first.items.map(row => row.id))
  expect(result.plan.exactCount + result.plan.missingCount).toBe(50)
  expect(result.plan.approximateCount).toBe(0)
  expect(result.tiles.flatMap(tile => Array.from({ length: tile.recordCount }, (_, row) => tile.metadata.idAt(row)))).toEqual(result.plan.requestIds)
  console.log(JSON.stringify({ sourceRecords: first.totalRecords, page: 50, exact: result.plan.exactCount, missing: result.plan.missingCount, inventoryHash: first.manifest.inventoryManifestSha256 }))
}, 100_000)
