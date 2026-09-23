import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../../src/engine/dynamics/de440Dynamics'
import { propagateDynamicsCovariance } from '../../src/engine/dynamics/covariancePropagation'
import { parseSbdbCovariance } from '../../src/data/loaders/sbdbCovariance'
import eros from '../fixtures/sbdb-eros-covariance.json'
import bennu from '../fixtures/sbdb-bennu-covariance.json'
import reference from '../fixtures/dynamics-covariance-reference.json'

const bytes = readFileSync(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`)
const gmText = readFileSync('src/data/gm_de440.tpc', 'utf8')
const create = (solar1pn = false) => createDe440Dynamics({
  spkBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength), gmText,
  referenceEpochTdb: reference.referenceEpochTdb, elapsedRangeSeconds: [-864000, 2592000],
  exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 0])), solarRelativity: solar1pn,
})

test('independent covariance reference retains exact source and generator hashes', () => {
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
  expect(sha('tests/fixtures/sbdb-eros-covariance.json')).toBe(reference.sourceSha256)
  expect(sha('scripts/reference-dynamics-covariance.py')).toBe(reference.generatorSha256)
  expect(sha('scripts/reference-orbit-covariance.py')).toBe(reference.coordinateGeneratorSha256)
  expect(sha('src/data/gm_de440.tpc')).toBe(reference.gmSha256)
  expect(DE440_DYNAMICS_SOURCE.sha256).toBe(reference.spkSha256)
})

for (const example of reference.cases) test(`conditional covariance agrees with direct DOP853 covariance evolution: ${example.durationSeconds/86400} days, 1PN=${example.solar1pn}`, async () => {
  const result = await propagateDynamicsCovariance(await create(example.solar1pn), parseSbdbCovariance(eros), example.durationSeconds)
  expect(result.experiment.forceModel.solarRelativity !== null).toBe(example.solar1pn)
  for (let i = 0; i < 6; i++) {
    expect(Math.abs(result.finalCoordinates.nominal[i]-example.nominal[i])).toBeLessThan(i < 3 ? 2e-12 : 2e-14)
    for (let j = 0; j < 6; j++) {
      const scale = Math.sqrt(example.matrix[i][i]*example.matrix[j][j])
      expect(Math.abs(result.finalCoordinates.matrix[i][j]-example.matrix[i][j])/scale).toBeLessThan(2e-9)
      expect(result.finalCoordinates.matrix[i][j]).toBe(result.finalCoordinates.matrix[j][i])
    }
  }
  expect(result.finalCoordinates.epoch).toEqual({ referenceEpochTdb: reference.referenceEpochTdb, elapsedTdbSeconds: example.durationSeconds })
  expect(example.refinementMaxSigmaNormalized).toBeLessThan(1e-11)
})

test('freezes the source before yielding and rejects unmatched parameters, epochs and cancellation', async () => {
  const dynamics = await create(), source = parseSbdbCovariance(eros), original = structuredClone(source)
  const pending = propagateDynamicsCovariance(dynamics, source, 2592000)
  source.matrix[0][0] = 0
  source.nominal[0] = 0
  expect((await pending).source).toEqual(original)
  await expect(propagateDynamicsCovariance(dynamics, parseSbdbCovariance(bennu), 0)).rejects.toThrow('every additional source parameter')
  await expect(propagateDynamicsCovariance(dynamics, { ...original, solutionEpochTdb: original.solutionEpochTdb+1 }, 0)).rejects.toThrow('solution epoch')
  const controller = new AbortController()
  controller.abort()
  await expect(propagateDynamicsCovariance(dynamics, original, 86400, controller.signal)).rejects.toThrow('Integration cancelled')
  await expect(propagateDynamicsCovariance(dynamics, original, 366*86400)).rejects.toThrow('365 days')
})
