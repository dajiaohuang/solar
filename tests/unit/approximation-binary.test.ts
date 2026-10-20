import { expect, it } from 'vitest'
import { decodeApproximationBinary, encodeApproximationBinary } from '../../src/engine/ephemeris/approximationBinary'
import { evaluateApproximation } from '../../src/engine/ephemeris/segmentedApproximation'

const document = { schemaVersion: 1, id: 'moon', parentId: 'earth', sourceManifestSha256: 'a'.repeat(64), sourceKernelHashes: ['b'.repeat(64)],
  segments: [{ startEt: 100, endEt: 200, sampledPositionErrorKm: .123456789, sampledVelocityErrorKmS: .0000123,
    coefficients: [Array.from({ length: 17 }, (_, i) => Math.PI * 1e8 / (i + 1)), Array(17).fill(-0), Array(17).fill(Math.E / 1e10)] }] }

it('preserves every coefficient and evaluated position/velocity without quantization', () => {
  const bytes = encodeApproximationBinary(document), restored = decodeApproximationBinary(bytes)
  expect(restored).toEqual(document)
  for (const et of [100, 127.1828, 161.8034, 200]) expect(evaluateApproximation(restored.segments[0], et)).toEqual(evaluateApproximation(document.segments[0], et))
  expect(bytes.byteLength).toBeLessThan(JSON.stringify(document).length)
})

it('fails closed on malformed lengths, unsupported orders and nonfinite coefficients', () => {
  const bytes = encodeApproximationBinary(document)
  expect(() => decodeApproximationBinary(bytes.subarray(0, bytes.length - 1))).toThrow()
  expect(() => decodeApproximationBinary(new Uint8Array([...bytes, 0]))).toThrow('trailing')
  const invalid = bytes.slice(), view = new DataView(invalid.buffer)
  const start = 16 + view.getUint32(4, true)
  view.setUint8(start, 255)
  expect(() => decodeApproximationBinary(invalid)).toThrow('degree')
  view.setUint8(start, 17)
  const scalars = view.getUint32(12, true), payload = start + view.getUint32(8, true)
  for (let plane = 0; plane < 8; plane++) invalid[payload + plane * scalars] = plane === 6 ? 0xf0 : plane === 7 ? 0x7f : 0
  expect(() => decodeApproximationBinary(invalid)).toThrow('Nonfinite')
})
