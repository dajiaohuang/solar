import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { splitSpkCrop } from '../../scripts/split-spk-crop.mjs'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'solar-split-spk-')); directories.push(directory)
  const input = join(directory, 'source.bsp'), output = join(directory, 'split')
  const bytes = await readFile('tests/fixtures/jup347-himalia-join.bsp')
  const evidence = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), source: { source: 'https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/jup347.bsp' } }
  await writeFile(input, bytes)
  await writeFile(`${input}.json`, JSON.stringify(evidence))
  return { input, output, evidence }
}
it('splits original adjacent segments with exact target, source, hash and state-parity evidence', async () => {
  const { input, output, evidence } = await fixture()
  const manifest = await splitSpkCrop({ input, output })
  expect(manifest.inputSha256).toBe(evidence.sha256)
  expect(manifest.files).toHaveLength(1)
  expect(manifest.files[0]).toMatchObject({ targets: [506], centers: [5], source: evidence.source.source })
  expect(manifest.files[0].segments).toHaveLength(2)
  expect(manifest.files[0].cropParityEpochs.length).toBeGreaterThanOrEqual(3)
  const bytes = await readFile(join(output, manifest.files[0].path))
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.files[0].sha256)
  expect(JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))).toEqual(manifest)
  await expect(splitSpkCrop({ input, output })).rejects.toThrow()
  expect(JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))).toEqual(manifest)
})
it('rejects corrupted input and lost original provenance without publishing a manifest', async () => {
  const { input, output, evidence } = await fixture()
  await writeFile(`${input}.json`, JSON.stringify({ ...evidence, sha256: '0'.repeat(64) }))
  await expect(splitSpkCrop({ input, output })).rejects.toThrow('integrity')
  await expect(readFile(join(output, 'manifest.json'))).rejects.toThrow()
  for (const source of [input, '/tmp/source.bsp', 'C:\\source.bsp', 'file:///tmp/source.bsp', 'http://example.test/source.bsp', undefined]) {
    await writeFile(`${input}.json`, JSON.stringify({ ...evidence, source: { source } }))
    await expect(splitSpkCrop({ input, output })).rejects.toThrow('provenance')
    await expect(readFile(join(output, 'manifest.json'))).rejects.toThrow()
  }
})
