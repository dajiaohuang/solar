const CHUNK_BYTES = 24 * 1024 // Multiple of three: only the final block is padded.
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024

function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Bounded scratch; never expands a typed array into a JS number array. */
export function encodeCatalogMask(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_EVIDENCE_BYTES) throw new RangeError('Catalog mask exceeds export byte limit')
  const parts: string[] = []
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    parts.push(encodeBytes(bytes.subarray(offset, offset+CHUNK_BYTES)))
  }
  return { encoding: 'base64', elementType: 'uint8', length: bytes.length, byteLength: bytes.byteLength, data: parts.join('') } as const
}

/** Explicit little endian, independent of the exporting machine byte order. */
export function encodeCatalogEpochs(values: Float64Array) {
  if (values.byteLength > MAX_EVIDENCE_BYTES || values.length % 4) throw new RangeError('Invalid catalog epoch export layout')
  const parts: string[] = [], scratch = new Uint8Array(Math.min(CHUNK_BYTES, values.byteLength))
  const view = new DataView(scratch.buffer)
  for (let start = 0; start < values.length; start += CHUNK_BYTES/8) {
    const count = Math.min(CHUNK_BYTES/8, values.length-start)
    for (let row = 0; row < count; row++) {
      const value = values[start+row]
      if (!Number.isFinite(value)) throw new Error('Nonfinite catalog epoch evidence')
      view.setFloat64(row*8, value, true)
    }
    parts.push(encodeBytes(scratch.subarray(0, count*8)))
  }
  return { encoding: 'base64', elementType: 'float64', byteOrder: 'little-endian',
    length: values.length, byteLength: values.byteLength, data: parts.join('') } as const
}
