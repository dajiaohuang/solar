import { DE440_DYNAMICS_SOURCE } from '../engine/dynamics/de440Source'

/** Bounded transport only. Scientific consumers still verify the pinned hash. */
export async function fetchDe440Bytes(signal?: AbortSignal): Promise<ArrayBuffer> {
  const controller = new AbortController()
  const deadline = performance.now() + 30_000
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(abort, 30_000)
  const check = () => {
    if (controller.signal.aborted || performance.now() >= deadline) {
      controller.abort()
      throw new Error('DE440 source download was cancelled or exceeded its 30-second deadline')
    }
  }
  let response: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let consumed = false
  try {
    check()
    response = await fetch(`${import.meta.env.BASE_URL}data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`, { signal: controller.signal })
    check()
    if (!response.ok) throw new Error(`DE440 source unavailable: HTTP ${response.status}`)
    reader = response.body?.getReader()
    if (!reader) throw new Error('DE440 response body unavailable')
    const bytes = new Uint8Array(DE440_DYNAMICS_SOURCE.bytes)
    let offset = 0
    while (true) {
      const chunk = await reader.read()
      check()
      if (chunk.done) { consumed = true; break }
      if (chunk.value.byteLength > bytes.length - offset) throw new Error('Oversized DE440 source')
      bytes.set(chunk.value, offset)
      offset += chunk.value.byteLength
    }
    if (offset !== bytes.length) throw new Error('Truncated DE440 source')
    return bytes.buffer
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    if (!consumed) {
      controller.abort()
      try {
        if (reader) await reader.cancel()
        else await response?.body?.cancel()
      } catch { /* Preserve the original transport/size failure. */ }
    }
    reader?.releaseLock()
  }
}
