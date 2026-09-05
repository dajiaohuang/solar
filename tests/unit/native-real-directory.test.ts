import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error Executable native validation module.
import { pinnedNativeInventory, realDirectoryPrefix, realDirectoryScenario, verifyRealDirectoryTraffic } from '../../scripts/native-real-directory.mjs'

afterEach(() => vi.unstubAllGlobals())
const hash = 'a'.repeat(64), catalog = 'b'.repeat(64)
const sourceIds = Array.from({ length: 50 }, (_, i) => `source:${i}`)
const manifest = { inventoryManifestSha256: hash, catalogManifestSha256: catalog }
const page = { ...manifest, totalRecords: 100, sourceRecords: true, identityAssertions: true, uniqueBodySemantics: 'not-deduplicated', limit: 50, items: sourceIds.map(id => ({ id })) }
const plan = { ...manifest, bodyCount: 51, tileCount: 1, exactCount: 10, approximateCount: 0, missingCount: 41, planId: 'c'.repeat(64) }

it('requires explicit matching local inventory identity, never fabricates a default', async () => {
  expect(await pinnedNativeInventory()).toBeNull()
  await expect(pinnedNativeInventory('/unused')).rejects.toThrow('explicit')
  const directory = await mkdtemp(join(tmpdir(), 'solar-native-directory-test-'))
  try {
    const raw = JSON.stringify({ totalRecords: 100 })
    await writeFile(join(directory, 'manifest.json'), raw)
    const digest = createHash('sha256').update(raw).digest('hex')
    expect((await pinnedNativeInventory(directory, digest)).totalRecords).toBe(100)
    await expect(pinnedNativeInventory(directory, hash)).rejects.toThrow('SHA-256 mismatch')
  } finally { await rm(directory, { recursive: true }) }
})

it('builds expectations from original page IDs and a pinned real-handler plan', async () => {
  const mock = vi.fn().mockResolvedValueOnce(Response.json(manifest)).mockResolvedValueOnce(Response.json(page)).mockResolvedValueOnce(Response.json(plan))
  vi.stubGlobal('fetch', mock)
  const result = await realDirectoryScenario('http://127.0.0.1', { sha256: hash, totalRecords: 100 })
  expect(result.sourceIds).toEqual(sourceIds); expect(result.ids).toEqual([...sourceIds, 'naif:10'])
  expect(result.exactCount).toBe(10); expect(result.missingCount).toBe(41)
  expect(JSON.parse(mock.mock.calls[2][1].body).ids).toEqual(result.ids)
  for (const invalid of [{ ...page, inventoryManifestSha256: catalog }, { ...page, uniqueBodySemantics: 'unique' }, { ...page, items: page.items.slice(1) }]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(manifest)).mockResolvedValueOnce(Response.json(invalid)))
    await expect(realDirectoryScenario('http://127.0.0.1', { sha256: hash, totalRecords: 100 })).rejects.toThrow()
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(manifest)).mockResolvedValueOnce(new Response('x'.repeat(256 * 1024 + 1))))
  await expect(realDirectoryScenario('http://127.0.0.1', { sha256: hash, totalRecords: 100 })).rejects.toThrow('budget')
})

it('requires exactly the native browse/select/plan/tile sequence and original scientific request', () => {
  const scenario = { sourceIds, ids: [...sourceIds, 'naif:10'], epochJd: 2461287.5, exactCount: 10, missingCount: 41 }
  const request = { ids: scenario.ids, epochJd: scenario.epochJd, precision: 'exact', timeScale: 'TDB', frame: 'ECLIPJ2000' }
  const traffic = [['GET', 'v1/catalog/manifest'], ['GET', 'v1/identities?q=&limit=50'], ['GET', 'v1/catalog/manifest'], ['POST', 'v1/state/plan'], ['POST', 'v1/state/tiles']]
    .map(([method, path], i) => ({ method, path: realDirectoryPrefix + path, status: 200, bytes: 123, requestBody: i === 3 ? JSON.stringify(request) : '' }))
  expect(verifyRealDirectoryTraffic(traffic, scenario)).toMatchObject({ status: 'passed', selectedSourceRecords: 50, requestedRecordsWithReference: 51 })
  expect(verifyRealDirectoryTraffic([], null).status).toBe('not-configured')
  expect(() => verifyRealDirectoryTraffic(traffic, null)).toThrow()
  expect(() => verifyRealDirectoryTraffic(traffic.slice(1), scenario)).toThrow()
  expect(() => verifyRealDirectoryTraffic([...traffic, traffic[0]], scenario)).toThrow()
  traffic[3].requestBody = JSON.stringify({ ...request, ids: [...scenario.ids].reverse() })
  expect(() => verifyRealDirectoryTraffic(traffic, scenario)).toThrow('source IDs')
})
