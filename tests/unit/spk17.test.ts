import { describe, expect, it } from 'vitest'
import { evaluateType17, inspectType17 } from '../../src/engine/ephemeris/spkType17'
import { SpkKernel } from '../../src/engine/ephemeris/spk'
import { cropSpk } from '../../scripts/crop-spk.mjs'
import oracle from '../fixtures/spk17-cspice.json'
import expanded from '../fixtures/spk17-cspice-expanded.json'

function sourceFor(elements: number[], little = true) {
  const bytes = Buffer.alloc(4096)
  bytes.write('DAF/SPK ', 0); bytes.write(little ? 'LTL-IEEE' : 'BIG-IEEE', 88)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const int = (offset: number, n: number) => view.setInt32(offset, n, little)
  const double = (offset: number, n: number) => view.setFloat64(offset, n, little)
  int(8, 2); int(12, 6); int(76, 2); int(80, 2); int(84, 397)
  double(1040, 1); double(1048, -2e9); double(1056, 2e9)
  ;[65304, 699, 1, 17, 385, 396].forEach((n, i) => int(1064 + 4 * i, n))
  elements.forEach((n, i) => double(3072 + i * 8, n))
  return { bytes, size: bytes.length, identity: { source: 'synthetic-type17' }, read: async (start: number, length: number) => bytes.subarray(start, start + length) }
}
const kernelFrom = (bytes: Buffer) => new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))

describe('SPK Type 17 CSPICE oracle', () => {
  it('matches EQNCPV for nonzero inclination and precession', () => {
    for (const sample of oracle.samples) {
      const s = evaluateType17(address => oracle.elements[address - 1], 1, sample.et)
      const actual = [...Object.values(s.position), ...Object.values(s.velocity)]
      // The ±1e9 s samples intentionally exercise many revolutions; trig
      // argument reduction limits absolute agreement to sub-micro precision.
      sample.state.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 6))
    }
  })

  it('matches independent CSPICE positions and velocities across five element sets and 40 epochs', () => {
    for (const sample of expanded.samples) {
      const elements = expanded.records[sample.record]
      const state = evaluateType17(address => elements[address - 1], 1, sample.et)
      const actual = [...Object.values(state.position), ...Object.values(state.velocity)]
      actual.forEach((value, axis) => expect(Math.abs(value - sample.state[axis]), `${sample.record}/${sample.et}/${axis}`).toBeLessThan(axis < 3 ? 2e-6 : 1e-9))
    }
  })

  it.each([true, false])('retains the entire 12-word record and clips only coverage (little endian %s)', async little => {
    const source = sourceFor(expanded.records[2], little)
    const original = kernelFrom(source.bytes)
    const result = await cropSpk(source, { startEt: -1e6, endEt: 1e6, targets: [65304] })
    const cropped = kernelFrom(result.buffer)
    const segment = cropped.segments[0]
    expect(segment).toMatchObject({ type: 17, target: 65304, center: 699, frame: 1, recordSize: 12, recordCount: 1, startEt: -1e6, endEt: 1e6 })
    const offset = (segment.startAddress - 1) * 8
    // The crop writer normalizes byte order, preserving the original values.
    expanded.records[2].forEach((value, index) => expect(result.buffer.readDoubleLE(offset + index * 8)).toBe(value))
    for (const et of [-1e6, -100, 0, 100, 1e6]) expect(cropped.evaluate(65304, et)).toEqual(original.evaluate(65304, et))
    expect(cropped.evaluate(65304, -1e6 - .001)).toBeNull()
    expect(cropped.evaluate(65304, 1e6 + .001)).toBeNull()
  })

  it('rejects malformed or unsupported elements before accepting a crop or runtime kernel', async () => {
    for (const [index, value] of [[1, 0], [2, .95], [3, Infinity], [8, 0]] as const) {
      const elements = [...expanded.records[0]]; elements[index] = value
      const source = sourceFor(elements)
      expect(() => kernelFrom(source.bytes)).toThrow()
      await expect(cropSpk(source, { startEt: -100, endEt: 100 })).rejects.toThrow()
    }
    expect(() => inspectType17(() => 0, 1, 13)).toThrow('12 doubles')
    expect(() => evaluateType17(address => expanded.records[0][address - 1], 1, Infinity)).toThrow('nonfinite')
  })
})
