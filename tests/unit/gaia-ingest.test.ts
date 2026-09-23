import { readFile } from 'node:fs/promises'
import { expect, test, vi } from 'vitest'
import { columns, parseCount, parseSources, queries, sha256, spatialChunks } from '../../scripts/lib/gaia-dr3.mjs'
import { retrieveGaiaCone } from '../../scripts/fetch-gaia-cone.mjs'

const root = 'tests/fixtures/gaia-pleiades-20260923/'
const manifest = JSON.parse(await readFile(root+'manifest.json', 'utf8'))
const countBytes = await readFile(root+'count.csv'), rowBytes = await readFile(root+'rows.csv')
test('real ESA source count and Float64 records retain exact string IDs and source bytes', async () => {
  for (const entry of [...manifest.sources, ...manifest.chunks]) {
    const bytes = await readFile(root+entry.path); expect(bytes.length).toBe(entry.bytes); expect(sha256(bytes)).toBe(entry.sha256)
  }
  const count = parseCount(countBytes, 1024), rows = parseSources(rowBytes, manifest.settings, count)
  expect(count).toBe(19); expect(rows[0].source_id).toBe('65212004581252736')
  expect(typeof rows[0].source_id).toBe('string')
  expect(rows[0].ra).toBe(56.6929147034245)
  expect(spatialChunks(rows)[0]).toEqual(JSON.parse(await readFile(root+manifest.chunks[0].path, 'utf8')))
})
test('rejects truncated, duplicated, out-of-cone and invalid uncertainty rows', () => {
  const lines = rowBytes.toString().trimEnd().split('\n')
  for (const mutate of [
    (v: string[]) => v.pop(),
    (v: string[]) => { v[2] = v[1] },
    (v: string[]) => { const row = v[1].split(','); row[columns.indexOf('ra')] = '200'; v[1] = row.join(',') },
    (v: string[]) => { const row = v[1].split(','); row[columns.indexOf('ra_error')] = '-1'; v[1] = row.join(',') },
    (v: string[]) => { const row = v[1].split(','); row[columns.indexOf('ra_dec_corr')] = '1.1'; v[1] = row.join(',') },
  ]) { const changed = [...lines]; mutate(changed); expect(() => parseSources(Buffer.from(changed.join('\n')), manifest.settings, 19)).toThrow() }
  expect(() => parseCount(countBytes, 18)).toThrow(/budget/)
  expect(() => queries({ ...manifest.settings, radiusDeg: Infinity })).toThrow()
})
test('retains null measurements and negative parallax without deriving distance', () => {
  const lines = rowBytes.toString().trimEnd().split('\n'), row = lines[1].split(',')
  row[columns.indexOf('parallax')] = '-0.5'; row[columns.indexOf('radial_velocity')] = ''; lines[1] = row.join(',')
  const first = parseSources(Buffer.from(lines.join('\n')), manifest.settings, 19)[0]
  expect(first.parallax).toBe(-0.5); expect(first.radial_velocity).toBeNull(); expect(first).not.toHaveProperty('distance')
})
test('wrap and polar bins preserve actual coordinates', () => {
  const chunks = spatialChunks([{ source_id: '1', ra: 359.9, dec: 90 }, { source_id: '2', ra: 0, dec: -90 }])
  expect(chunks.map((c: {key: string}) => c.key)).toEqual(['r0-d0', 'r71-d35'])
})
test('count precedes rows, overbudget avoids second query and cancelled reads never publish', async () => {
  const fetcher = vi.fn(async (url: URL) => new Response(url.searchParams.get('QUERY')!.includes('COUNT') ? countBytes : rowBytes, { headers: { 'Content-Type': 'text/csv' } }))
  const result = await retrieveGaiaCone(manifest.settings, { fetcher })
  expect(result.rows).toHaveLength(19); expect(fetcher).toHaveBeenCalledTimes(2)
  fetcher.mockClear()
  await expect(retrieveGaiaCone({ ...manifest.settings, maxRows: 18 }, { fetcher })).rejects.toThrow(/budget/)
  expect(fetcher).toHaveBeenCalledTimes(1)
  const abort = new AbortController()
  await expect(retrieveGaiaCone(manifest.settings, { signal: abort.signal, fetcher: async () => { abort.abort(); return new Response(countBytes, { headers: { 'Content-Type': 'text/csv' } }) } })).rejects.toBeDefined()
})
