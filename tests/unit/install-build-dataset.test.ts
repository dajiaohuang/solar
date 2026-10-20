import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createDeterministicDatasetArchive, sha256File } from '../../scripts/package-dataset.mjs'
import { datasetArchiveUrl, installBuildDataset, validateDatasetArchiveEntries } from '../../scripts/lib/install-build-dataset.mjs'

const execute = promisify(execFile)
const temporary: string[] = []
afterEach(async () => {
  for (const path of temporary.splice(0)) {
    if (!resolve(path).startsWith(`${process.cwd()}${sep}.dataset-test-build-`)) throw new Error('Unsafe fixture cleanup')
    await rm(path, { recursive: true, force: true })
  }
})

it('rejects unsafe archive paths, duplicate members, links, and incomplete pins before extraction', () => {
  const pin = { schemaVersion: 1, tag: 'dataset-mpcorb-0123456789abcdef-full', version: 'mpcorb-0123456789abcdef-full', asset: 'asteroid-dataset.tar.gz', assetSha256: 'a'.repeat(64) }
  expect(datasetArchiveUrl(pin)).toBe(`https://github.com/dajiaohuang/solar/releases/download/${pin.tag}/${pin.asset}`)
  for (const patch of [{ asset: '../file' }, { version: 'other' }, { assetSha256: 'unknown' }, { tag: '../main' }]) {
    expect(() => datasetArchiveUrl({ ...pin, ...patch })).toThrow()
  }
  expect(() => validateDatasetArchiveEntries('dataset-version.json\nreleases/x/manifest.json\n', '-rw-r--r-- metadata\n-rw-r--r-- metadata\n')).not.toThrow()
  for (const path of ['../outside', '/absolute', 'C:/outside', 'a\\outside', 'a/../outside', 'dataset-version.json']) {
    expect(() => validateDatasetArchiveEntries(`dataset-version.json\n${path}\n`, '-rw-r--r-- metadata\n-rw-r--r-- metadata\n')).toThrow()
  }
  expect(() => validateDatasetArchiveEntries('dataset-version.json\nlink\n', '-rw-r--r-- metadata\nlrwxrwxrwx metadata\n')).toThrow('links')
})

it('restores a real pinned full dataset through tar and the production validator without replacing existing data', async () => {
  const root = await mkdtemp(resolve('.dataset-test-build-')); temporary.push(root)
  const source = join(root, 'MPCORB.DAT'), generated = join(root, 'generated'), cache = join(root, 'cache')
  const row = Array(194).fill(' ')
  const put = (offset: number, text: string) => [...text].forEach((character, index) => { row[offset + index] = character })
  put(0, '0001001'); put(8, ' 8.10'); put(20, 'K2411'); put(26, ' 10.0000'); put(37, ' 73.0000')
  put(48, ' 80.0000'); put(59, ' 10.6000'); put(70, '0.0758000'); put(80, '0.214000000')
  put(92, '  2.3100000'); put(161, '0000'); put(166, '1001 Atlas Alpha')
  await writeFile(source, `MPCORB integration fixture\n---------------------------\n${row.join('')}\n`)
  await execute(process.execPath, ['scripts/preprocess-asteroids.mjs'], { env: {
    ...process.env, MPCORB_SOURCE_FILE: source, MPCORB_OUTPUT_DIR: generated,
    MPCORB_MODE: 'full', MPCORB_REQUIRE_FEATURED: '0', MPCORB_CHUNK_SIZE: '2',
  } })
  const pointer = JSON.parse(await readFile(join(generated, 'dataset-version.json'), 'utf8'))
  const archive = join(root, 'dataset.tar.gz')
  await createDeterministicDatasetArchive(generated, archive)
  const sha256 = await sha256File(archive)
  await mkdir(cache)
  await copyFile(archive, join(cache, `${sha256}.ndjson.gz`))
  const pin = { schemaVersion: 1, tag: `dataset-${pointer.activeVersion}`, version: pointer.activeVersion,
    asset: 'asteroid-dataset.tar.gz', assetSha256: sha256 }
  const restored = join(root, 'restored')
  await installBuildDataset(pin, restored, cache)
  expect(await readFile(join(restored, 'dataset-version.json'), 'utf8')).toBe(await readFile(join(generated, 'dataset-version.json'), 'utf8'))
  await expect(installBuildDataset(pin, restored, cache)).resolves.toBe(restored)
  const wrong = { ...pin, version: 'mpcorb-0000000000000000-full', tag: 'dataset-mpcorb-0000000000000000-full' }
  await expect(installBuildDataset(wrong, restored, cache)).rejects.toThrow('differs')
  const partial = join(root, 'partial'); await mkdir(partial); await writeFile(join(partial, 'keep.txt'), 'user data')
  await expect(installBuildDataset(pin, partial, cache)).rejects.toThrow('already exists')
  expect(await readFile(join(partial, 'keep.txt'), 'utf8')).toBe('user data')
}, 30_000)
