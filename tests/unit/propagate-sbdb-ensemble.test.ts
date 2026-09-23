import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { propagateEnsembleFile } from '../../scripts/propagate-sbdb-ensemble.mjs'

test('offline ensemble receipts preserve source, implementation, seed and existing outputs', async () => {
  const directory = await mkdtemp(join(tmpdir(),'solar-ensemble-')), output = join(directory,'receipt.json')
  const source = 'tests/fixtures/sbdb-eros-covariance.json'
  const options = { durationSeconds: 86400,exclusionKm: 1,count: 4,seed: 42,solarRelativity: true }
  const summary = await propagateEnsembleFile(source,output,options)
  expect(summary.valid).toBe(4)
  const original = await readFile(output,'utf8'), receipt = JSON.parse(original)
  expect(receipt.sampling.seed).toBe(42)
  expect(receipt.finalStates).toHaveLength(24)
  expect(receipt.moments.covarianceDivisor).toBe(3)
  expect(receipt.sourceFile.sha256).toBe(createHash('sha256').update(await readFile(source)).digest('hex'))
  for (const [path,hash] of Object.entries(receipt.implementationSha256)) expect(hash).toBe(createHash('sha256').update(await readFile(path)).digest('hex'))
  await expect(propagateEnsembleFile(source,output,options)).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await readFile(output,'utf8')).toBe(original)
  const unused = join(directory,'rejected.json')
  await expect(propagateEnsembleFile(source,unused,{...options,signal: AbortSignal.abort()})).rejects.toMatchObject({ name: 'AbortError' })
  await expect(propagateEnsembleFile('tests/fixtures/sbdb-bennu-covariance.json',unused,options)).rejects.toThrow('no axes will be dropped')
  await expect(propagateEnsembleFile(source,unused,{...options,count: 129})).rejects.toThrow('1 to 128')
  const large = join(directory,'large.json')
  await writeFile(large,Buffer.alloc(2*1024*1024+1))
  await expect(propagateEnsembleFile(large,unused,options)).rejects.toThrow('2 MiB')
  await expect(readFile(unused)).rejects.toMatchObject({ code: 'ENOENT' })
})
