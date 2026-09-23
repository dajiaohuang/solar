import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { convertCovarianceFile } from '../../scripts/convert-sbdb-covariance.mjs'

it('exports the source, adopted GM, complete joint matrix and reproducible offsets without overwriting output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-covariance-convert-'))
  try {
    const output = join(directory, 'converted.json')
    const summary = await convertCovarianceFile('tests/fixtures/sbdb-bennu-covariance.json', output, { count: 10, seed: 17 })
    const first = await readFile(output), data = JSON.parse(first.toString('utf8'))
    expect(summary).toMatchObject({ dimension: 8, epochTdb: 2455562.5 })
    expect(data.result.labels.slice(6)).toEqual(['RHO', 'AMRAT'])
    expect(data.sourceSha256).toBe(createHash('sha256').update(await readFile('tests/fixtures/sbdb-bennu-covariance.json')).digest('hex'))
    expect(data.adoptedGM.sha256).toBe(createHash('sha256').update(await readFile('src/data/gm_de440.tpc')).digest('hex'))
    expect(data.sampling).toMatchObject({ count: 10, dimension: 8, seed: 17 })
    expect(data.sampling.offsets).toHaveLength(80)
    await expect(convertCovarianceFile('tests/fixtures/sbdb-bennu-covariance.json', output)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(output)).toEqual(first)
    const secondOutput = join(directory, 'second.json')
    await convertCovarianceFile('tests/fixtures/sbdb-bennu-covariance.json', secondOutput, { count: 10, seed: 17 })
    expect(await readFile(secondOutput)).toEqual(first)
  } finally { await rm(directory, { recursive: true }) }
})
