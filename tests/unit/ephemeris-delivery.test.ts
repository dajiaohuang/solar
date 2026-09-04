import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
// @ts-expect-error Offline Node verifier intentionally has no browser typings.
import { verifyEphemerisAssets } from '../../scripts/lib/verify-ephemeris-assets.mjs'

it('rejects same-size replacement files and content corruption in a native pack', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-ephemeris-delivery-'))
  const bytes = Buffer.from('a verified test record')
  const files = [{ path: 'original.bsp', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]
  try {
    await writeFile(join(directory, 'original.bsp'), bytes)
    expect(await verifyEphemerisAssets(directory, files)).toBe(bytes.length)
    await rm(join(directory, 'original.bsp'))
    await writeFile(join(directory, 'rogue.bsp'), bytes)
    await expect(verifyEphemerisAssets(directory, files)).rejects.toThrow('file set')
    await rm(join(directory, 'rogue.bsp'))
    await writeFile(join(directory, 'original.bsp'), Buffer.alloc(bytes.length))
    await expect(verifyEphemerisAssets(directory, files)).rejects.toThrow('integrity')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('refuses a legacy regeneration before changing the expanded manifest', async () => {
  const path = 'src/data/ephemeris-manifest.json'
  const before = await readFile(path)
  const result = spawnSync(process.execPath, ['scripts/build-ephemerides.mjs'], { encoding: 'utf8', timeout: 10000 })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Refusing to overwrite an expanded')
  expect(await readFile(path)).toEqual(before)
})
