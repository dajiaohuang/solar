// Catalog artifacts are independently sharded. Bound both wire data and gzip
// expansion before retaining a complete artifact in memory.
export const MAX_CATALOG_ARTIFACT_BYTES = 64 * 1024 * 1024

export async function readBoundedStream(stream: ReadableStream<Uint8Array>, maximumBytes = MAX_CATALOG_ARTIFACT_BYTES) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new RangeError('Invalid artifact byte limit')
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let complete = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) { complete = true; break }
      size += value.byteLength
      if (size > maximumBytes) throw new Error(`Catalog artifact exceeds ${maximumBytes} bytes`)
      if (value.byteLength) chunks.push(value)
    }
    const buffer = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
    return buffer.buffer
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
