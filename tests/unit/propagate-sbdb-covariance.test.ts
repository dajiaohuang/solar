import { mkdtemp, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { propagateCovarianceFile } from '../../scripts/propagate-sbdb-covariance.mjs'

test('conditional covariance CLI exports source/model evidence, preserves existing output and refuses partial parameter models', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-covariance-'))
  const output = join(directory, 'receipt.json'), source = 'tests/fixtures/sbdb-eros-covariance.json'
  const options = { durationSeconds: 86400, exclusionKm: 1, solarRelativity: true }
  await propagateCovarianceFile(source, output, options)
  const bytes = await readFile(output, 'utf8'), receipt = JSON.parse(bytes)
  expect(receipt.sourceFile.sha256).toBe(createHash('sha256').update(await readFile(source)).digest('hex'))
  expect(receipt.sourceFile.payload).toEqual(JSON.parse(await readFile(source, 'utf8')))
  expect(receipt.experiment.forceModel.solarRelativity.speedOfLightKmPerSecond).toBe(299792.458)
  expect(receipt.finalCoordinates.matrix).toHaveLength(6)
  expect(receipt.finalCoordinates.epoch.elapsedTdbSeconds).toBe(86400)
  for (const [path, hash] of Object.entries(receipt.implementationSha256)) {
    expect(hash).toBe(createHash('sha256').update(await readFile(path)).digest('hex'))
  }
  await expect(propagateCovarianceFile(source, output, options)).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await readFile(output, 'utf8')).toBe(bytes)
  const unused = join(directory, 'rejected.json')
  await expect(propagateCovarianceFile('tests/fixtures/sbdb-bennu-covariance.json', unused, options)).rejects.toThrow('no axes will be dropped')
  await expect(propagateCovarianceFile(source, unused, { ...options, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
  await expect(propagateCovarianceFile(source, unused, { ...options, exclusionKm: -1 })).rejects.toThrow('exclusion distance')
  await expect(readFile(unused)).rejects.toMatchObject({ code: 'ENOENT' })
})
