import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseSbdbCovariance } from '../../src/data/loaders/sbdbCovariance'
import { cartesianStatesFromSourceOffsets } from '../../src/engine/ephemeris/covarianceStateSamples'
import eros from '../fixtures/sbdb-eros-covariance.json'
import bennu from '../fixtures/sbdb-bennu-covariance.json'
import reference from '../fixtures/covariance-state-samples-reference.json'

const gm = reference.adoptedSolarGM

it.each(reference.cases)('matches independent 80-digit nonlinear coordinates: $name', async sample => {
  expect(createHash('sha256').update(readFileSync('tests/fixtures/orbit-covariance-reference.json')).digest('hex')).toBe(reference.inputReferenceSha256)
  const source = parseSbdbCovariance(sample.source === 'eros' ? eros : bennu)
  const result = await cartesianStatesFromSourceOffsets(source, gm, new Float64Array(sample.offsets))
  expect([...result.valid]).toEqual([1])
  expect(result.failures).toEqual([])
  result.states.forEach((value, i) => expect(Math.abs(value-sample.state[i])).toBeLessThan(i < 3 ? 2e-14 : 5e-16))
  expect([...result.additionalValues]).toEqual(source.nominal.slice(6).map((v,i) => v+sample.offsets[6+i]))
})

it('preserves tiny periapsis-time offsets that disappear when added to Julian dates', async () => {
  const source = parseSbdbCovariance(eros), offsets = new Float64Array(12)
  offsets[8] = 1e-10
  expect(source.nominal[2]+offsets[8]).toBe(source.nominal[2])
  const result = await cartesianStatesFromSourceOffsets(source, gm, offsets)
  const expected = reference.cases.find(x => x.name === 'eros-tiny-tp')!
  const nominal = reference.cases.find(x => x.name === 'eros-nominal')!
  for (let i = 0; i < 3; i++) {
    const delta = result.states[6+i]-result.states[i]
    expect(Math.abs(delta-(expected.state[i]-nominal.state[i]))).toBeLessThan(2e-15)
  }
  expect(result.states.slice(6)).not.toEqual(result.states.slice(0,6))
})

it('owns input snapshots across cooperative yields and honors permuted axes', async () => {
  const source = parseSbdbCovariance(eros), original = structuredClone(source), adopted = { ...gm }
  const offsets = new Float64Array([.01,-.02,.03,.04,-.05,.06]), originalOffsets = offsets.slice()
  const pending = cartesianStatesFromSourceOffsets(source, adopted, offsets)
  source.nominal.fill(0); adopted.au3PerDay2 = 0; offsets.fill(0)
  const result = await pending
  expect(result.source).toEqual(original)
  expect(result.offsets).toEqual(originalOffsets)
  expect(result.adoptedSolarGM).toEqual(gm)
  const order = [5,3,1,0,2,4]
  const permuted = { ...original, labels: order.map(i => original.labels[i]), units: order.map(i => original.units[i]),
    nominal: order.map(i => original.nominal[i]), matrix: order.map(i => order.map(j => original.matrix[i][j])) }
  const mapped = await cartesianStatesFromSourceOffsets(permuted, gm, new Float64Array(order.map(i => originalOffsets[i])))
  expect(mapped.states).toEqual(result.states)
})

it('retains failed draw indices and never resamples, clips or loses fitted parameters', async () => {
  const source = parseSbdbCovariance(bennu), offsets = new Float64Array(24)
  offsets[8] = -2; offsets[22] = 1.25; offsets[23] = .00002
  const result = await cartesianStatesFromSourceOffsets(source, gm, offsets)
  expect([...result.valid]).toEqual([1,0,1])
  expect(result.failures).toHaveLength(1)
  expect(result.failures[0].index).toBe(1)
  expect(result.failures[0].reason.length).toBeGreaterThan(0)
  expect(result.states.slice(6,12).every(Number.isNaN)).toBe(true)
  expect(result.additionalValues.slice(2,4).every(Number.isNaN)).toBe(true)
  expect(result.offsets).toEqual(offsets)
  expect([...result.additionalValues.slice(4)]).toEqual([source.nominal[6]+1.25,source.nominal[7]+.00002])
})

it('bounds workload and rejects pre-cancelled or interrupted batches without partial publication', async () => {
  const source = parseSbdbCovariance(eros)
  for (const offsets of [new Float64Array(), new Float64Array(7), new Float64Array(60006), new Float64Array([NaN,0,0,0,0,0])]) {
    await expect(cartesianStatesFromSourceOffsets(source,gm,offsets)).rejects.toThrow(/1 to 10000/)
  }
  const tooLarge = new Float64Array(60006)
  tooLarge.slice = () => { throw new Error('Oversized input must not be copied') }
  await expect(cartesianStatesFromSourceOffsets(source,gm,tooLarge)).rejects.toThrow(/1 to 10000/)
  const before = new AbortController(); before.abort()
  await expect(cartesianStatesFromSourceOffsets(source,gm,new Float64Array(6),before.signal)).rejects.toThrow()
  const during = new AbortController()
  const pending = cartesianStatesFromSourceOffsets(source,gm,new Float64Array(60000),during.signal)
  setTimeout(() => during.abort(), 0)
  await expect(pending).rejects.toThrow()
})
