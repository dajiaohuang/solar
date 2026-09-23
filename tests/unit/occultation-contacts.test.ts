import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import { findOccultationContacts } from '../../src/engine/events/occultationContacts'
import { sphericalOccultation } from '../../src/engine/events/sphericalOccultation'
import { createDe440Dynamics, DE440_FORCE_IDS } from '../../src/engine/dynamics/de440Dynamics'
import { loadPckRadii } from '../../src/data/loaders/pckRadii'
import reference from '../fixtures/occultation-contacts-reference.json'

const bytes = (path: string) => {
  const data = readFileSync(path)
  return data.buffer.slice(data.byteOffset, data.byteOffset+data.byteLength)
}
const defaults = { startSeconds: -2, endSeconds: 2, maxStepSeconds: .7, toleranceSeconds: 1e-6 }
const polynomial = (t: number) => ({ externalGapRadians: t*t-1, internalGapRadians: t*t-.25 })

test('source and GF generator hashes match', () => {
  for (const source of reference.sources) expect(createHash('sha256').update(readFileSync(source.path)).digest('hex')).toBe(source.sha256)
  expect(createHash('sha256').update(readFileSync('scripts/reference-occultation-contacts.py')).digest('hex')).toBe(reference.generatorSha256)
})

for (const row of reference.cases) test(`verified SPK/PCK contacts agree with independent GF windows: ${row.name}`, async () => {
  const states = await createDe440Dynamics({ spkBytes: bytes(reference.sources[0].path), gmText: readFileSync('src/data/gm_de440.tpc', 'utf8'),
    referenceEpochTdb: row.referenceEpochTdb, elapsedRangeSeconds: [row.startSeconds, row.endSeconds], exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 0])) })
  const shapes = await loadPckRadii(bytes(reference.sources[1].path))
  const result = await findOccultationContacts({ startSeconds: row.startSeconds, endSeconds: row.endSeconds,
    maxStepSeconds: 300, toleranceSeconds: .01, evaluate(time) {
      const observer = states.state(row.observerId, time)
      const body = (id: number) => {
        const state = states.state(id, time), shape = shapes.get(id)!
        expect(shape.representation).toBe('sphere')
        return { positionKm: [state[0]-observer[0], state[1]-observer[1], state[2]-observer[2]] as [number, number, number], radiusKm: shape.radiiKm[0] }
      }
      return sphericalOccultation(body(row.foregroundId), body(row.backgroundId))
    } })
  expect(result.contacts).toHaveLength(row.contacts.length)
  for (let i = 0; i < row.contacts.length; i++) {
    const found = result.contacts[i], expected = row.contacts[i]
    expect(found.boundary).toBe(expected.boundary)
    expect(found.direction).toBe(expected.direction)
    expect(Math.abs(found.elapsedTdbSeconds-expected.elapsedTdbSeconds)).toBeLessThan(.02)
    expect(found.bracketSeconds[1]-found.bracketSeconds[0]).toBeLessThanOrEqual(.01)
  }
  expect(result.possibleMissedEvents).toBe(true)
  expect(result.maximumScanIntervalSeconds).toBe(300)
  expect(result.startGapsRadians.external).toBeGreaterThan(0)
  expect(result.endGapsRadians.external).toBeGreaterThan(0)
})

test('brackets analytic external/internal contacts and retains window-edge state', async () => {
  const result = await findOccultationContacts({ ...defaults, evaluate: polynomial })
  expect(result.contacts.map(contact => [contact.boundary, contact.direction])).toEqual([
    ['external', 'enter'], ['internal', 'enter'], ['internal', 'exit'], ['external', 'exit'],
  ])
  for (const [i, expected] of [-1, -.5, .5, 1].entries()) {
    const [lo, hi] = result.contacts[i].bracketSeconds
    expect(lo).toBeLessThanOrEqual(expected)
    expect(hi).toBeGreaterThanOrEqual(expected)
    expect(hi-lo).toBeLessThanOrEqual(defaults.toleranceSeconds)
  }
  const inside = await findOccultationContacts({ ...defaults, startSeconds: -.1, endSeconds: .1, evaluate: polynomial })
  expect(inside.contacts).toEqual([])
  expect(inside.startGapsRadians.external).toBeLessThan(0)
  expect(inside.endGapsRadians.external).toBeLessThan(0)
})

test('sampled zeros are not duplicated or asserted to be crossings, and empty output does not certify completeness', async () => {
  const zero = await findOccultationContacts({ ...defaults, startSeconds: -1, endSeconds: 1, maxStepSeconds: 1,
    evaluate: t => ({ externalGapRadians: t, internalGapRadians: 1 }) })
  expect(zero.contacts).toEqual([{ boundary: 'external', direction: 'sampled-zero', elapsedTdbSeconds: 0, bracketSeconds: [0, 0] }])
  const missed = await findOccultationContacts({ ...defaults, startSeconds: 0, endSeconds: 1, maxStepSeconds: 1,
    evaluate: t => ({ externalGapRadians: (t-.5)**2-.01, internalGapRadians: 1 }) })
  expect(missed.contacts).toHaveLength(0)
  expect(missed.coverage).toBe('sampled-sign-changes-only')
  expect(missed.possibleMissedEvents).toBe(true)
})

test('budgets, invalid sources and cancellation reject rather than publish incomplete contacts', async () => {
  await expect(findOccultationContacts({ ...defaults, maxEvaluations: 2, evaluate: polynomial })).rejects.toThrow('budget')
  await expect(findOccultationContacts({ ...defaults, startSeconds: 0, endSeconds: 2, maxStepSeconds: 2, maxEvaluations: 2, evaluate: polynomial })).rejects.toThrow('refinement')
  await expect(findOccultationContacts({ ...defaults, maxContacts: 1, evaluate: polynomial })).rejects.toThrow('result budget')
  await expect(findOccultationContacts({ ...defaults, evaluate: () => ({ externalGapRadians: NaN, internalGapRadians: 1 }) })).rejects.toThrow('nonfinite')
  await expect(findOccultationContacts({ ...defaults, signal: AbortSignal.abort(), evaluate: polynomial })).rejects.toMatchObject({ name: 'AbortError' })
  const controller = new AbortController()
  let calls = 0
  const timer = setTimeout(() => controller.abort(), 0)
  try {
    await expect(findOccultationContacts({ ...defaults, startSeconds: 0, endSeconds: 1000, maxStepSeconds: 1, signal: controller.signal,
      evaluate: () => { calls++; return { externalGapRadians: 1, internalGapRadians: 1 } } })).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBeLessThanOrEqual(64)
  } finally { clearTimeout(timer) }
})

test('reports actual rounded sample spacing rather than a nominal interval', async () => {
  const times: number[] = []
  const result = await findOccultationContacts({ startSeconds: 1e12, endSeconds: 1e12+1, maxStepSeconds: .1, toleranceSeconds: .01,
    evaluate: time => { times.push(time); return { externalGapRadians: 1, internalGapRadians: 1 } } })
  expect(result.requestedMaxStepSeconds).toBe(.1)
  expect(result.maximumScanIntervalSeconds).toBe(Math.max(...times.slice(1).map((time, i) => time-times[i])))
  expect(result.maximumScanIntervalSeconds).toBeGreaterThan(.1)
})
