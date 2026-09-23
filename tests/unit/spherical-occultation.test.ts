import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { beforeAll, expect, test } from 'vitest'
import { sphericalOccultation, type SphereDirection } from '../../src/engine/events/sphericalOccultation'
import { createDe440Dynamics, DE440_FORCE_IDS } from '../../src/engine/dynamics/de440Dynamics'
import { loadPckRadii } from '../../src/data/loaders/pckRadii'
import reference from '../fixtures/spherical-occultation-reference.json'

const readBytes = (path: string) => {
  const bytes = readFileSync(path)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength)
}
let states: Awaited<ReturnType<typeof createDe440Dynamics>>
let shapes: Awaited<ReturnType<typeof loadPckRadii>>
const epoch = reference.cases[0].epochTdb
beforeAll(async () => {
  states = await createDe440Dynamics({ spkBytes: readBytes(reference.sources[0].path), gmText: readFileSync('src/data/gm_de440.tpc', 'utf8'),
    referenceEpochTdb: epoch, elapsedRangeSeconds: [0, (Math.max(...reference.cases.map(row => row.epochTdb))-epoch)*86400],
    exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 0])) })
  shapes = await loadPckRadii(readBytes(reference.sources[1].path))
})

test('source/generator identities match the independent occult reference', () => {
  for (const source of reference.sources) expect(createHash('sha256').update(readFileSync(source.path)).digest('hex')).toBe(source.sha256)
  expect(createHash('sha256').update(readFileSync('scripts/reference-spherical-occultation.py')).digest('hex')).toBe(reference.generatorSha256)
})

for (const row of reference.cases) test(`actual verified SPK/PCK geometry matches CSPICE occult: ${row.name}`, () => {
  const elapsed = (row.epochTdb-epoch)*86400, observer = states.state(row.observerId, elapsed)
  const body = (id: number): SphereDirection => {
    const shape = shapes.get(id)!
    expect(shape.representation).toBe('sphere')
    const state = states.state(id, elapsed)
    return { positionKm: [state[0]-observer[0], state[1]-observer[1], state[2]-observer[2]], radiusKm: shape.radiiKm[0] }
  }
  const result = sphericalOccultation(body(row.foregroundId), body(row.backgroundId))
  expect({ none: 0, partial: 1, annular: 2, total: 3 }[result.classification]).toBe(row.occultCode)
  expect(Math.abs(result.separationRadians-row.separationRadians)).toBeLessThan(2e-13)
})

const sphere = (radiusKm: number, distance: number, angle = 0): SphereDirection => ({ radiusKm, positionKm: [distance*Math.sin(angle), 0, distance*Math.cos(angle)] })

test('analytic angular disks distinguish containment, partial overlap and tiny separations', () => {
  expect(sphericalOccultation(sphere(2, 10), sphere(100, 1000)).classification).toBe('total')
  expect(sphericalOccultation(sphere(1, 10), sphere(200, 1000)).classification).toBe('annular')
  expect(sphericalOccultation(sphere(1, 10, .25), sphere(200, 1000)).classification).toBe('partial')
  expect(sphericalOccultation(sphere(1, 10, .5), sphere(200, 1000)).classification).toBe('none')
  expect(sphericalOccultation(sphere(1, 10, 1e-12), sphere(200, 1000)).separationRadians).toBeCloseTo(1e-12, 25)
  const result = sphericalOccultation(sphere(1, 10), sphere(100, 1000))
  expect(result.foregroundAngularRadiusRadians).toBe(Math.asin(.1))
  expect(result.internalContact).toBe(true)
})

test('rejects nonfinite, interior-observer and ambiguous or reversed depth inputs', () => {
  const back = sphere(200, 1000)
  expect(() => sphericalOccultation(sphere(2, 1), back)).toThrow('outside')
  expect(() => sphericalOccultation(sphere(0, 10), back)).toThrow('positive radii')
  expect(() => sphericalOccultation(sphere(1, Infinity), back)).toThrow('finite')
  expect(() => sphericalOccultation(sphere(1e-300, 1e300), back)).toThrow('numerical range')
  expect(() => sphericalOccultation(back, sphere(1, 10))).toThrow('depth')
  expect(() => sphericalOccultation(sphere(2, 10), sphere(2, 11))).toThrow('depth')
})
