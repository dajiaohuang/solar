import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import { downloadSnapshot, SOURCE_URLS } from '../../scripts/lib/inventory-snapshot.mjs'
import { buildInventory } from '../../scripts/build-body-inventory.mjs'
import { validateInventory } from '../../scripts/validate-body-inventory.mjs'

const directories: string[] = []
afterEach(async () => { vi.unstubAllGlobals(); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture(numberedCount = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'solar-inventory-pipeline-')); directories.push(directory)
  const metadata = { updated: '2026-09-03 09:32:35 UTC', list: [{ url: '/dat/ELEMENTS.NUMBR', count: String(numberedCount) }, { url: '/dat/ELEMENTS.UNNUM', count: '1' }, { url: '/dat/ELEMENTS.COMET', count: '1' }] }
  const contents: Record<string, string | Buffer> = {
    metadata: JSON.stringify(metadata),
    numbered: gzipSync('     1 Ceres             61200 2.7655526 0.07969230 10.58803 73.29421 80.24863 274.4193464 3.34 0.12 JPL 48\n'),
    unnumbered: gzipSync('  1927 LA     25051 3.3440715 0.33361825 17.63150 341.10952 191.71742 45.7201688 11.00 0.15 JPL 11\n'),
    comets: `${'1P/Halley'.padEnd(44)}39875 0.57486383 0.96793600 162.19053 112.24143 59.09895 19860208.47362 JPL 75\n`,
    planetarySatellites: 'A total of 1 planetary satellites<table class="sat-discovery table"><tr><td>Satellites of Mars: 1</td></tr><tr><td>I</td><td>Phobos</td><td></td><td>1877</td><td>Hall</td><td>IAU</td></tr></table>',
    smallBodySatellites: JSON.stringify({ signature: { version: '1.0', source: 'NASA/JPL Small-Body Satellites API' }, count: 1, data: [{ sat: { pdes: '1', kind: 'an', confirmed: 'N', iau_num: null, prov_year: 2000, prov_num: null, ref: 'Synthetic candidate fixture' } }] }),
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: { method: string }) => {
    const key = Object.entries(SOURCE_URLS).find(([, value]) => value === url)?.[0]
    if (!key) throw new Error(`Unexpected fixture URL: ${url}`)
    return new Response(options.method === 'HEAD' ? null : contents[key], { headers: { etag: 'fixture-v1' } })
  }))
  const sources = join(directory, 'sources')
  await downloadSnapshot(sources)
  return { directory, sources }
}

it('replays every source row into deterministic addressable blocks with separate SPK evidence', async () => {
  const { directory, sources } = await fixture()
  const first = join(directory, 'first'), second = join(directory, 'second')
  const manifest = await buildInventory({ sources, output: first, shardSize: 2 })
  expect(manifest.totalRecords).toBe(16)
  expect(manifest.schemaVersion).toBe(2)
  expect(manifest.purpose).toBe('source-inventory-addressable-v2')
  expect(manifest.counts.confirmations.candidate).toBe(1)
  expect(manifest.missingParents).toEqual([])
  for (const shard of manifest.shards) {
    expect(shard.file).toMatch(/^records-\d{5}\.jsonl\.bgz$/)
    expect(shard.blocks).toHaveLength(1)
    expect(shard.blocks[0]).toMatchObject({ rowStart: 0, count: shard.count, offset: 0 })
  }
  expect((await validateInventory(first, sources)).recordsVerified).toBe(16)
  expect(await buildInventory({ sources, output: second, shardSize: 2 })).toEqual(manifest)
  for (const shard of manifest.shards) expect(await readFile(join(second, shard.file))).toEqual(await readFile(join(first, shard.file)))
  await expect(buildInventory({ sources, output: first })).rejects.toThrow()
})

it('never publishes a successful manifest when source rows do not match metadata', async () => {
  const { directory, sources } = await fixture(2)
  const output = join(directory, 'bad-count')
  await expect(buildInventory({ sources, output })).rejects.toThrow('Source count mismatch')
  await expect(readFile(join(output, 'manifest.json'))).rejects.toThrow()
})
