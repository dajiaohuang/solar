// Catalog artifacts are independently sharded. Bound both wire data and gzip
// expansion before retaining a complete artifact in memory.
export const MAX_CATALOG_ARTIFACT_BYTES = 64 * 1024 * 1024

export async function readBoundedStream(stream: ReadableStream<Uint8Array>, maximumBytes = MAX_CATALOG_ARTIFACT_BYTES, signal?: AbortSignal) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new RangeError('Invalid artifact byte limit')
  const reader = stream.getReader()
  // Own consumed bytes immediately. Retaining every upstream view scales with
  // chunk count and can pin a much larger backing buffer behind a small view.
  // Grow geometrically rather than preallocating the default 64 MiB for JSON.
  let buffer = new Uint8Array(0)
  let size = 0
  let complete = false
  let cancellation: Promise<void> | undefined
  const cancelRead = () => cancellation ??= reader.cancel(signal?.reason).catch(() => undefined)
  const abort = () => { void cancelRead() }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    signal?.throwIfAborted()
    while (true) {
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      if (done) { complete = true; break }
      if (value.byteLength > maximumBytes - size) throw new Error(`Catalog artifact exceeds ${maximumBytes} bytes`)
      const nextSize = size + value.byteLength
      if (nextSize > buffer.length) {
        const capacity = Math.min(maximumBytes, Math.max(nextSize, buffer.length * 2, 64 * 1024))
        const next = new Uint8Array(capacity)
        next.set(buffer.subarray(0, size))
        buffer = next
      }
      buffer.set(value, size)
      size = nextSize
    }
    return size === buffer.length ? buffer.buffer : buffer.slice(0, size).buffer
  } finally {
    signal?.removeEventListener('abort', abort)
    // Abort closes pending reads before underlying cancellation necessarily
    // finishes. Keep caller admission until that original cleanup settles.
    if (!complete) await cancelRead()
    reader.releaseLock()
  }
}
