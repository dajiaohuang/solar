import { describe, expect, it } from 'vitest'
import { assembleStateTiles, digestStateTileRequestIds, fetchStateTiles, readStateTileJson, validateStateTileManifest, validateStateTilePlan } from '../../src/lib/stateTiles'

// Opt-in integration against a separately running real Go process and staged
// original SPK profile. This does not replace the independent CSPICE oracle.
const base = process.env.SOLAR_TEST_BACKEND_URL?.replace(/\/+$/, '')
const epochJd = 2461287.5
const signal = () => AbortSignal.timeout(60_000)
const bits = (value: number) => {
  const bytes = new ArrayBuffer(8)
  const view = new DataView(bytes)
  view.setFloat64(0, value, true)
  return view.getBigUint64(0, true)
}
async function json(path: string, body?: unknown) {
  if (!base || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new Error('Live tests require an explicit loopback backend')
  return readStateTileJson(await fetch(`${base}/v1/${path}`, {
    signal: signal(),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }), path)
}
async function load(ids: string[]) {
  const manifest = validateStateTileManifest(await json('catalog/manifest'))
  const rawPlan = await json('state/plan', { ids, epochJd, timeScale: 'TDB', frame: 'ECLIPJ2000', precision: 'exact', fieldMask: ['position', 'velocity'], tileSize: 16384 })
  const plan = validateStateTilePlan(rawPlan, manifest, epochJd, ids, await digestStateTileRequestIds(ids))
  const tiles = assembleStateTiles(await fetchStateTiles({ base: base!, plan, signal: signal() }), plan)
  return { manifest, plan, tiles }
}

describe.skipIf(!base)('live Go → Web state-tile integration', () => {
  it('preserves all catalog IDs, exact provenance, and Float64 values across the real HTTP wire', async () => {
    const ids: string[] = []
    let pageToken = ''
    do {
      const page = await json(`catalog?limit=500&pageToken=${encodeURIComponent(pageToken)}`) as { items: { id: string }[]; nextPageToken: string }
      ids.push(...page.items.map(row => row.id))
      pageToken = page.nextPageToken
      if (ids.length > 32768) throw new Error('Unexpected catalog size; paginate plans explicitly')
    } while (pageToken)
    expect(ids.length).toBeGreaterThan(510)
    const { tiles } = await load([...ids, 'test:unknown-identity'])
    expect(tiles.flatMap(tile => tile.metadata.map(row => row.id))).toEqual([...ids, 'test:unknown-identity'])
    const tile = tiles[0]
    expect(tile.metadata.at(-1)?.missingReason).toBe('unknown-identity')
    for (let row = 0; row < ids.length; row++) expect(tile.exactBitmap[row >> 3] & (1 << (row % 8))).not.toBe(0)
    const selected = ['sun', 'naif:10', 'earth', 'naif:399', 'naif:301', 'naif:599', 'naif:501']
    const trajectory = await json('trajectory', { bodyIds: selected, startJd: epochJd, endJd: epochJd + 0.01, samples: 2, frame: 'ECLIPJ2000', precision: 'exact' }) as { bodies: { id: string; states: number[]; availability: string }[] }
    for (const body of trajectory.bodies) {
      const row = tile.metadata.findIndex(item => item.id === body.id)
      expect(row).toBeGreaterThanOrEqual(0)
      expect(body.availability).toBe('operational')
      expect(tile.exactBitmap[row >> 3] & (1 << (row % 8))).not.toBe(0)
      expect(tile.metadata[row].datasetSha256).toBe(tile.catalogManifestSha256)
      expect(tile.metadata[row].kernelSha256).toMatch(/^[a-f0-9]{64}$/)
      for (let axis = 0; axis < 6; axis++) expect(bits(tile.states[row * 6 + axis])).toBe(bits(body.states[axis]))
    }
  }, 90_000)

  it('binds a real source-inventory state to its inventory and selected kernel identities', async () => {
    const id = 'sb:asteroid:1'
    const { manifest, tiles } = await load([id, 'naif:2000001'])
    expect(manifest.inventoryManifestSha256).toMatch(/^[a-f0-9]{64}$/)
    const tile = tiles[0]
    expect(tile.exactBitmap[0]).toBe(3)
    expect(tile.metadata[0].sourceRecord).toBe(true)
    expect(tile.metadata[0].datasetSha256).toBe(manifest.inventoryManifestSha256)
    expect(tile.metadata[1].sourceRecord).toBe(false)
    expect(tile.metadata[1].datasetSha256).toBe(manifest.catalogManifestSha256)
    expect(tile.metadata[0].kernelSha256).toBe(tile.metadata[1].kernelSha256)
    for (let axis = 0; axis < 6; axis++) expect(bits(tile.states[axis])).toBe(bits(tile.states[6 + axis]))
  }, 90_000)

  it('transports a full 32K plan without reordering and returns byte-stable repeated tiles', async () => {
    const ids = ['naif:10', 'naif:399', ...Array.from({ length: 32766 }, (_, i) => `test:missing:${i}`)]
    const { plan, tiles } = await load(ids)
    expect(tiles.map(tile => tile.recordCount)).toEqual([16384, 16384])
    expect(tiles.flatMap(tile => tile.metadata.map(row => row.id))).toEqual(ids)
    expect(tiles[0].exactBitmap[0]).toBe(3)
    expect(tiles[1].exactBitmap.every(byte => byte === 0)).toBe(true)
    const repeated = assembleStateTiles(await fetchStateTiles({ base: base!, plan, signal: signal() }), plan)
    expect(repeated.map(tile => tile.payloadSha256)).toEqual(tiles.map(tile => tile.payloadSha256))
    expect(repeated.flatMap(tile => [...tile.states])).toEqual(tiles.flatMap(tile => [...tile.states]))
  }, 90_000)
})
