import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { receptionLightTime } from '../../src/engine/ephemeris/receptionLightTime'
import { createDe440Dynamics, DE440_FORCE_IDS } from '../../src/engine/dynamics/de440Dynamics'
import { findOccultationFile } from '../../scripts/find-occultation-contacts.mjs'
import reference from '../fixtures/reception-contacts-reference.json'

test('reception iteration reproduces a closed-form moving target and owns observer input', () => {
  const distance = 150000000, velocity = 30, observer: [number, number, number] = [0, 0, 0]
  const result = receptionLightTime({ observerPositionKm: observer, targetPositionKm: time => {
    observer[0] = 1000
    return [distance+velocity*time, 0, 0]
  }, elapsedTdbSeconds: 0, maxLightTimeSeconds: 1000 })
  expect(Math.abs(result.lightTimeSeconds-distance/(299792.458+velocity))).toBeLessThan(1e-9)
  expect(result.positionKm[0]).toBe(distance+velocity*result.emissionElapsedTdbSeconds)
  expect(result.residualSeconds).toBeLessThanOrEqual(1e-9)
})

test('insufficient source margin, unconverged iteration and lost epoch precision fail explicitly', () => {
  const options = { observerPositionKm: [0, 0, 0] as const, targetPositionKm: () => [150000000, 0, 0] as const, elapsedTdbSeconds: 0, maxLightTimeSeconds: 1000 }
  expect(() => receptionLightTime({ ...options, maxLightTimeSeconds: 100 })).toThrow('source margin')
  expect(() => receptionLightTime({ ...options, maxIterations: 1 })).toThrow('did not converge')
  expect(() => receptionLightTime({ ...options, elapsedTdbSeconds: 1e30 })).toThrow('numerical time resolution')
  expect(() => receptionLightTime({ ...options, targetPositionKm: () => [Infinity, 0, 0] })).toThrow('Nonfinite')
  expect(() => receptionLightTime({ ...options, targetPositionKm: () => { throw new Error('Missing emission coverage') } })).toThrow('Missing emission coverage')
})

test('reference generator and actual sources retain exact byte identity', () => {
  for (const source of reference.sources) expect(createHash('sha256').update(readFileSync(source.path)).digest('hex')).toBe(source.sha256)
  expect(createHash('sha256').update(readFileSync('scripts/reference-reception-contacts.py')).digest('hex')).toBe(reference.generatorSha256)
})

for (const row of reference.cases) test(`CN directions and offline contacts match independent CSPICE: ${row.name}`, async () => {
  const data = readFileSync(reference.sources[0].path)
  const states = await createDe440Dynamics({ spkBytes: data.buffer.slice(data.byteOffset, data.byteOffset+data.byteLength), gmText: readFileSync('src/data/gm_de440.tpc', 'utf8'),
    referenceEpochTdb: row.referenceEpochTdb, elapsedRangeSeconds: [-80000, 43200], exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 0])) })
  const position = (id: number, time: number) => Array.from(states.state(id, time).subarray(0, 3)) as [number, number, number]
  for (const direction of row.directionsAtReferenceEpoch) {
    const result = receptionLightTime({ observerPositionKm: position(row.observerId, 0), targetPositionKm: t => position(direction.targetId, t), elapsedTdbSeconds: 0, maxLightTimeSeconds: 36000 })
    result.positionKm.forEach((value, i) => expect(Math.abs(value-direction.positionKm[i])).toBeLessThan(2e-5))
    expect(Math.abs(result.lightTimeSeconds-direction.lightTimeSeconds)).toBeLessThan(2e-9)
  }
  const directory = await mkdtemp(join(tmpdir(), 'solar-reception-')), input = join(directory, 'input.json'), output = join(directory, 'receipt.json')
  const payload = { schemaVersion: 1, frame: 'J2000', timeScale: 'TDB', aberration: 'CN', foregroundId: row.foregroundId,
    backgroundId: row.backgroundId, observerId: row.observerId, referenceEpochTdb: row.referenceEpochTdb,
    startSeconds: row.startSeconds, endSeconds: row.endSeconds, maxStepSeconds: 300, toleranceSeconds: .01, maxLightTimeSeconds: 36000 }
  await writeFile(input, JSON.stringify(payload))
  await findOccultationFile(input, output)
  const result = JSON.parse(await readFile(output, 'utf8'))
  expect(result.contacts).toHaveLength(row.contacts.length)
  for (const [i, contact] of row.contacts.entries()) {
    expect(result.contacts[i].boundary).toBe(contact.boundary)
    expect(result.contacts[i].direction).toBe(contact.direction)
    expect(Math.abs(result.contacts[i].elapsedTdbSeconds-contact.elapsedTdbSeconds)).toBeLessThan(.02)
  }
  expect(result.reception.observedMaximumResidualSeconds).toBeLessThanOrEqual(1e-9)
  expect(result.ephemeris.aberration).toBe('CN')
  expect(result.physicalTimingUncertaintySeconds).toBeNull()
  expect(result.ephemerisStateRequests).toBeGreaterThan(result.evaluations*3)
  const rejected = join(directory, 'rejected.json')
  await writeFile(input, JSON.stringify({ ...payload, maxLightTimeSeconds: .1 }))
  await expect(findOccultationFile(input, rejected)).rejects.toThrow('source margin')
  await expect(readFile(rejected)).rejects.toMatchObject({ code: 'ENOENT' })
})
