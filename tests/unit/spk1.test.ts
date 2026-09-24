import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import { SpkKernel } from '../../src/engine/ephemeris/spk'
import reference from '../fixtures/spk1-synthetic.json'

const bytes = readFileSync(new URL('../fixtures/spk1-synthetic.bsp', import.meta.url))
const buffer = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
const kernel = new SpkKernel(buffer())

test('Type 1 matches independent CSPICE at all record edges and directory transitions', () => {
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference.kernelSha256)
  expect(kernel.segments.map(segment => segment.type)).toEqual([1, 1])
  expect(kernel.segments.map(segment => segment.recordCount)).toEqual([1, 101])
  expect(reference.samples).toHaveLength(408)
  for (const sample of reference.samples) {
    const result = kernel.evaluate(sample.target, sample.et)!
    const actual = [...Object.values(result.position), ...Object.values(result.velocity)]
    actual.forEach((value, i) => expect(Math.abs(value - sample.state[i])).toBeLessThan(i < 3 ? 1e-7 : 1e-14))
  }
})

test('Type 1 rejects extended orders, malformed epochs and corrupt directory entries', () => {
  const segment = kernel.segments[1], epochs = segment.type1!.epochsAddress
  for (const [address, value] of [[segment.startAddress + 67, 16], [segment.startAddress + 68, 15],
    [epochs + 1, -Infinity], [epochs + 101, -1], [segment.endAddress, 100], [segment.startAddress + 1, 0]]) {
    const bad = buffer()
    new DataView(bad).setFloat64((address - 1) * 8, value, true)
    expect(() => new SpkKernel(bad)).toThrow('Invalid SPK type 1:')
  }
  expect(() => kernel.evaluateChebyshevAtOffset(segment.target, segment.startEt, 0)).toThrow('Type 2 or 3')
  expect(() => kernel.getRecordData(segment)).toThrow('type 2 or 3')
})

test('validated segment descriptors and Type 1 metadata cannot be changed through public references', () => {
  const segment = kernel.segments[1]
  expect(Object.isFrozen(kernel.segments)).toBe(true)
  expect(Object.isFrozen(segment)).toBe(true)
  expect(Object.isFrozen(segment.type1)).toBe(true)
  expect(Reflect.set(segment, 'center', 999)).toBe(false)
  expect(Reflect.set(segment.type1!, 'recordCount', 1)).toBe(false)
  expect(Reflect.set(kernel, 'segments', [])).toBe(false)
})

test('big-endian Type 1 retains all six state components', () => {
  const converted = buffer(), view = new DataView(converted), original = new DataView(buffer())
  new Uint8Array(converted).set(new TextEncoder().encode('BIG-IEEE'), 88)
  for (const offset of [8, 12, 76, 80, 84]) view.setInt32(offset, original.getInt32(offset, true), false)
  const summary = (original.getInt32(76, true) - 1) * 1024
  for (const offset of [0, 8, 16]) view.setFloat64(summary + offset, original.getFloat64(summary + offset, true), false)
  kernel.segments.forEach((segment, index) => {
    const descriptor = summary + 24 + index * 40
    for (const offset of [0, 8]) view.setFloat64(descriptor + offset, original.getFloat64(descriptor + offset, true), false)
    for (let offset = 16; offset < 40; offset += 4) view.setInt32(descriptor + offset, original.getInt32(descriptor + offset, true), false)
    for (let address = segment.startAddress; address <= segment.endAddress; address++) view.setFloat64((address - 1) * 8, original.getFloat64((address - 1) * 8, true), false)
  })
  const big = new SpkKernel(converted)
  for (const sample of reference.samples) expect(big.evaluate(sample.target, sample.et)).toEqual(kernel.evaluate(sample.target, sample.et))
})
