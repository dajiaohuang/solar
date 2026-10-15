/** Preserve exact source bytes (including whitespace and numeric spelling).
 * Chunk at multiples of three so concatenated Base64 has no internal padding.
 * This is byte preservation, not source authentication.
 */
export function dynamicsSourceBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new RangeError('Dynamics source must contain 1 byte to 2 MiB')
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 12288) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 12288))))
  }
  return chunks.join('')
}
