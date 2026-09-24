import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { cropSpk } from '../../scripts/crop-spk.mjs'
import { SpkKernel } from '../../src/engine/ephemeris/spk'
import reference from '../fixtures/spk1-synthetic.json'

const original = readFileSync(new URL('../fixtures/spk1-synthetic.bsp', import.meta.url))
const source = (bytes = original) => ({ size: bytes.length, identity: { sha256: reference.kernelSha256 },
  read: async (start: number, length: number) => bytes.subarray(start, start + length) })
const parse = (bytes: Buffer) => new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))

test('Type 1 crop retains exact records and one-word footer across the hundred-record directory boundary', async () => {
  const segment = reference.segments[1]
  for (const count of [99, 100, 101]) {
    const endEt = segment.epochs[count - 1]
    const result = await cropSpk(source(), { startEt: segment.startEt, endEt, targets: [segment.target] })
    const kernel = parse(result.buffer), selected = kernel.segments[0]
    expect(selected.type).toBe(1)
    expect(selected.recordCount).toBe(count)
    expect(selected.endAddress - selected.startAddress + 1).toBe(count * 72 + Math.floor(count / 100) + 1)
    expect(result.buffer.subarray((selected.startAddress - 1) * 8, (selected.startAddress - 1 + count * 71) * 8))
      .toEqual(original.subarray((segment.startAddress - 1) * 8, (segment.startAddress - 1 + count * 71) * 8))
    for (const sample of reference.samples.filter(row => row.target === segment.target && row.et <= endEt)) {
      expect(kernel.evaluate(sample.target, sample.et)).toEqual(parse(original).evaluate(sample.target, sample.et))
    }
    expect(kernel.evaluate(segment.target, endEt + 1)).toBeNull()
  }
})

test('Type 1 crop rejects extended integration orders before producing output', async () => {
  const bytes = Buffer.from(original), segment = reference.segments[1]
  bytes.writeDoubleLE(16, (segment.startAddress - 1 + 67) * 8)
  await expect(cropSpk(source(bytes), { startEt: segment.startEt, endEt: segment.endEt, targets: [segment.target] })).rejects.toThrow('integration order')
})
