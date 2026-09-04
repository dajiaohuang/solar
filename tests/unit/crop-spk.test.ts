import { describe, expect, it } from 'vitest'
import { cropSpk, inspectSpk } from '../../scripts/crop-spk.mjs'
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

function syntheticType21Source(count = 205, corruptDirectory = false) {
  const maxdim = 15, dlsize = 4 * maxdim + 11, startAddress = 385
  const words = count * dlsize + count + Math.floor(count / 100) + 2
  const endAddress = startAddress + words - 1
  const buffer = Buffer.alloc((endAddress + 1) * 8), v = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  buffer.write('DAF/SPK ', 0, 'ascii'); buffer.write('LTL-IEEE', 88, 'ascii')
  v.setInt32(8, 2, true); v.setInt32(12, 6, true); v.setInt32(76, 3, true); v.setInt32(80, 3, true)
  const summary = 2 * 1024; v.setFloat64(summary + 16, 1, true)
  v.setFloat64(summary + 24, 1000, true); v.setFloat64(summary + 32, 1204, true)
  ;[499, 10, 1, 21, startAddress, endAddress].forEach((n, i) => v.setInt32(summary + 40 + i * 4, n, true))
  const at = (address: number) => (address - 1) * 8
  for (let record = 0; record < count; record++) {
    const offset = at(startAddress + record * dlsize)
    for (let i = 0; i < dlsize; i++) v.setFloat64(offset + i * 8, record * 1000 + i, true)
  }
  const epochStart = startAddress + count * dlsize
  for (let index = 0; index < count; index++) v.setFloat64(at(epochStart + index), 1000 + index, true)
  for (let index = 99; index < count; index += 100) v.setFloat64(at(epochStart + count + (index - 99) / 100), corruptDirectory && index === 199 ? 9999 : 1000 + index, true)
  v.setFloat64(at(endAddress - 1), maxdim, true); v.setFloat64(at(endAddress), count, true)
  return { size: buffer.length, identity: { source: 'synthetic-type21', bytes: buffer.length }, read: async (start: number, length: number) => buffer.subarray(start, start + length), close: async () => {} }
}

describe('crop-spk', () => {
  it('retains complete original records and emits a readable DAF/SPK', async () => {
    const result = await cropSpk(syntheticSource(), { startEt: 5, endEt: 15 })
    const arrayBuffer = result.buffer.buffer.slice(result.buffer.byteOffset, result.buffer.byteOffset + result.buffer.byteLength)
    const kernel = new SpkKernel(arrayBuffer)
    expect(kernel.segments[0]).toMatchObject({ target: 499, startEt: 5, endEt: 15, recordCount: 2, recordSize: 8 })
    expect(kernel.evaluate(499, 5)!.position.x).toBeCloseTo(1)
    expect(kernel.evaluate(499, 15)!.position.x).toBeCloseTo(2)
    const nestedSource = { size: result.buffer.length, identity: {}, read: async (start: number, length: number) => result.buffer.subarray(start, start + length) }
    const nested = await cropSpk(nestedSource, { startEt: 6, endEt: 14 })
    const nestedKernel = new SpkKernel(nested.buffer.buffer.slice(nested.buffer.byteOffset, nested.buffer.byteOffset + nested.buffer.byteLength))
    expect(nestedKernel.evaluate(499, 6)).toEqual(kernel.evaluate(499, 6))
    expect(nestedKernel.evaluate(499, 5)).toBeNull()
  })

  it('rejects a crop window with no coverage', async () => {
    await expect(cropSpk(syntheticSource(), { startEt: 30, endEt: 40 })).rejects.toThrow(/No selected SPK coverage/)
  })

  it('rejects non-finite intervals and incompatible coefficient strides', async () => {
    await expect(cropSpk(syntheticSource({ interval: Infinity }), { startEt: 5, endEt: 15 })).rejects.toThrow(/Invalid Chebyshev directory/)
    await expect(cropSpk(syntheticSource({ recordSize: 11 }), { startEt: 5, endEt: 15 })).rejects.toThrow(/Invalid Chebyshev directory/)
  })

  it('crops type 21 by final epochs and rebuilds its directory', async () => {
    const result = await cropSpk(syntheticType21Source(), { startEt: 1000, endEt: 1200 })
    const segment = (await inspectSpk({ size: result.buffer.length, read: async (start: number, length: number) => result.buffer.subarray(start, start + length) })).segments[0]
    expect(segment).toMatchObject({ type: 21, startEt: 1000, endEt: 1200 })
    const at = (address: number) => (address - 1) * 8
    const data = result.buffer
    const recordCount = 201, dlsize = 71
    expect(data.readDoubleLE(at(segment.startAddress + recordCount * dlsize))).toBe(1000)
    expect(data.readDoubleLE(at(segment.startAddress + recordCount * dlsize + 99))).toBe(1099)
    const footerAddress = segment.startAddress + recordCount * dlsize + recordCount + 2
    expect(data.readDoubleLE(at(footerAddress))).toBe(15)
    expect(data.readDoubleLE(at(footerAddress + 1))).toBe(recordCount)
    expect(data.readDoubleLE(at(segment.endAddress - 2))).toBe(1199)
    expect(data.readDoubleLE(at(segment.endAddress - 1))).toBe(15)
  })

  it('uses first-final-epoch-at-or-after bounds and fails closed on bad directories', async () => {
    const result = await cropSpk(syntheticType21Source(205), { startEt: 1000.5, endEt: 1003.5 })
    const segment = (await inspectSpk({ size: result.buffer.length, read: async (start: number, length: number) => result.buffer.subarray(start, start + length) })).segments[0], data = result.buffer
    const epochAddress = segment.startAddress + 4 * 71
    expect(data.readDoubleLE((epochAddress - 1) * 8)).toBe(1001)
    expect(data.readDoubleLE((epochAddress) * 8)).toBe(1002)
    expect(data.readDoubleLE((epochAddress + 1) * 8)).toBe(1003)
    await expect(cropSpk(syntheticType21Source(205, true), { startEt: 1000, endEt: 1200 })).rejects.toThrow(/Invalid type 21 epoch directory/)
  })
})
