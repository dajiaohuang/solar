import type { ApproximationSegment } from './segmentedApproximation'

export type ApproximationDocument = { schemaVersion: number; id: string; parentId: string; sourceManifestSha256: string;
  sourceKernelHashes: string[]; segments: ApproximationSegment[] }
const magic = 0x31424843 // CHB1, little endian

/** Lossless Float64 byte planes improve gzip compression without quantization. */
export function encodeApproximationBinary(document: ApproximationDocument): Uint8Array {
  const { segments, ...metadata } = document
  const header = new TextEncoder().encode(JSON.stringify(metadata))
  if (!segments.length) throw new Error('Empty binary approximation')
  const maximumDegree = Math.max(...segments.map(segment => segment.coefficients[0].length)), width = 4 + 3 * maximumDegree
  const scalarCount = segments.length * width
  const bytes = new Uint8Array(16 + header.length + segments.length + 8 * scalarCount), view = new DataView(bytes.buffer)
  view.setUint32(0, magic, true); view.setUint32(4, header.length, true); view.setUint32(8, segments.length, true); view.setUint32(12, scalarCount, true)
  bytes.set(header, 16)
  const data = new Uint8Array(8 * scalarCount), doubles = new DataView(data.buffer)
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i], count = segment.coefficients[0].length
    if (![9, 13, 17].includes(count) || segment.coefficients.length !== 3 || segment.coefficients.some(axis => axis.length !== count)) throw new Error('Unsupported binary approximation degree')
    bytes[16 + header.length + i] = count
    const values = [segment.startEt, segment.endEt, segment.sampledPositionErrorKm, segment.sampledVelocityErrorKmS,
      ...segment.coefficients.flatMap(axis => [...axis, ...Array(maximumDegree - count).fill(0)])]
    for (let column = 0; column < width; column++) {
      const value = values[column]
      if (!Number.isFinite(value)) throw new Error('Nonfinite binary approximation value')
      doubles.setFloat64(8 * (i * width + column), value, true)
    }
  }
  const offset = 16 + header.length + segments.length
  for (let plane = 0; plane < 8; plane++) for (let column = 0; column < width; column++) for (let row = 0; row < segments.length; row++) {
    bytes[offset + plane * scalarCount + column * segments.length + row] = data[8 * (row * width + column) + plane]
  }
  return bytes
}

export function decodeApproximationBinary(bytes: Uint8Array): ApproximationDocument {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 16 || view.getUint32(0, true) !== magic) throw new Error('Invalid approximation binary header')
  const headerBytes = view.getUint32(4, true), count = view.getUint32(8, true), scalarCount = view.getUint32(12, true)
  const offset = 16 + headerBytes + count
  const width = scalarCount / count, maximumDegree = (width - 4) / 3
  if (headerBytes > 1048576 || count < 1 || count > 65536 || ![9, 13, 17].includes(maximumDegree)
    || offset + 8 * scalarCount !== bytes.length) throw new Error('Invalid approximation binary dimensions or trailing bytes')
  for (let i = 0; i < count; i++) {
    const degree = bytes[16 + headerBytes + i]
    if (![9, 13, 17].includes(degree) || degree > maximumDegree) throw new Error('Invalid approximation binary degree')
  }
  const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(16, 16 + headerBytes)))
  const data = new Uint8Array(8 * scalarCount), doubles = new DataView(data.buffer)
  for (let plane = 0; plane < 8; plane++) for (let column = 0; column < width; column++) for (let row = 0; row < count; row++) {
    data[8 * (row * width + column) + plane] = bytes[offset + plane * scalarCount + column * count + row]
  }
  const read = (row: number, column: number) => {
    const value = doubles.getFloat64(8 * (row * width + column), true)
    if (!Number.isFinite(value)) throw new Error('Nonfinite binary approximation value')
    return value
  }
  const segments: ApproximationSegment[] = Array.from({ length: count }, (_, i) => {
    const startEt = read(i, 0), endEt = read(i, 1), sampledPositionErrorKm = read(i, 2), sampledVelocityErrorKmS = read(i, 3)
    const degree = bytes[16 + headerBytes + i]
    const coefficients = Array.from({ length: 3 }, (_, axis) => {
      for (let k = degree; k < maximumDegree; k++) if (read(i, 4 + axis * maximumDegree + k) !== 0) throw new Error('Invalid binary coefficient padding')
      return Array.from({ length: degree }, (_, k) => read(i, 4 + axis * maximumDegree + k))
    })
    return { startEt, endEt, sampledPositionErrorKm, sampledVelocityErrorKmS, coefficients }
  })
  return { ...metadata, segments }
}
