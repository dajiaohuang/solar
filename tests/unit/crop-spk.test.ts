import { describe, expect, it } from 'vitest'
import { cropSpk } from '../../scripts/crop-spk.mjs'
import { SpkKernel } from '../../src/engine/ephemeris/spk'

function syntheticSource(options: { interval?: number; recordSize?: number } = {}) {
  const buffer = Buffer.alloc(4 * 1024), v = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  buffer.write('DAF/SPK ', 0, 'ascii'); buffer.write('LTL-IEEE', 88, 'ascii')
  v.setInt32(8, 2, true); v.setInt32(12, 6, true); v.setInt32(76, 3, true); v.setInt32(80, 3, true)
  const summary = 2 * 1024; v.setFloat64(summary + 16, 1, true)
  v.setFloat64(summary + 24, 0, true); v.setFloat64(summary + 32, 20, true)
  ;[499, 10, 1, 2, 385, 404].forEach((n, i) => v.setInt32(summary + 40 + i * 4, n, true))
  const at = (address: number) => (address - 1) * 8
  for (let record = 0; record < 2; record++) {
    const offset = at(385 + record * 8)
    v.setFloat64(offset, record * 10 + 5, true); v.setFloat64(offset + 8, 5, true)
    for (let i = 0; i < 6; i++) v.setFloat64(offset + 16 + i * 8, record + i + 1, true)
  }
  const meta = at(401); v.setFloat64(meta, 0, true); v.setFloat64(meta + 8, options.interval ?? 10, true); v.setFloat64(meta + 16, options.recordSize ?? 8, true); v.setFloat64(meta + 24, 2, true)
  return { size: buffer.length, identity: { source: 'synthetic', bytes: buffer.length }, read: async (start: number, length: number) => buffer.subarray(start, start + length), close: async () => {} }
}

describe('crop-spk', () => {
  it('retains complete original records and emits a readable DAF/SPK', async () => {
    const result = await cropSpk(syntheticSource(), { startEt: 5, endEt: 15 })
    const arrayBuffer = result.buffer.buffer.slice(result.buffer.byteOffset, result.buffer.byteOffset + result.buffer.byteLength)
    const kernel = new SpkKernel(arrayBuffer)
    expect(kernel.segments[0]).toMatchObject({ target: 499, startEt: 5, endEt: 15, recordCount: 2, recordSize: 8 })
    expect(kernel.evaluate(499, 5)!.position.x).toBeCloseTo(1)
    expect(kernel.evaluate(499, 15)!.position.x).toBeCloseTo(2)
  })

  it('rejects a crop window with no coverage', async () => {
    await expect(cropSpk(syntheticSource(), { startEt: 30, endEt: 40 })).rejects.toThrow(/No selected SPK coverage/)
  })

  it('rejects non-finite intervals and incompatible coefficient strides', async () => {
    await expect(cropSpk(syntheticSource({ interval: Infinity }), { startEt: 5, endEt: 15 })).rejects.toThrow(/Invalid Chebyshev directory/)
    await expect(cropSpk(syntheticSource({ recordSize: 11 }), { startEt: 5, endEt: 15 })).rejects.toThrow(/Invalid Chebyshev directory/)
  })
})
