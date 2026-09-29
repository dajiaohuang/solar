/** Bounded browser source read. Cancellation stops FileReader itself, while
 * callers still guard subsequent digest/parse work against stale generations. */
export function readScientificSourceFile(file: File, signal: AbortSignal, limit = 2 * 1024 * 1024): Promise<ArrayBuffer> {
  const deadline = performance.now() + 25_000
  const timeout = () => new Error('Scientific source read exceeded 25 seconds')
  signal.throwIfAborted()
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8 * 1024 * 1024) return Promise.reject(new RangeError('Invalid scientific source byte budget'))
  if (file.size < 1 || file.size > limit) return Promise.reject(new RangeError(`Scientific source must contain 1 to ${limit} bytes`))
  return new Promise((resolve,reject) => {
    const reader = new FileReader()
    let settled = false

    const finish = (error?: unknown, bytes?: ArrayBuffer) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort',cancel)
      reader.onload = null; reader.onerror = null; reader.onabort = null
      if (reader.readyState === FileReader.LOADING) reader.abort()
      if (bytes) resolve(bytes)
      else reject(error ?? new Error('Scientific source read failed'))
    }
    const cancel = () => finish(signal.reason ?? new DOMException('Source read cancelled','AbortError'))
    signal.addEventListener('abort',cancel,{ once: true })
    reader.onload = () => {
      const bytes = reader.result
      if (signal.aborted) { cancel(); return }
      // FileReader and timer callbacks may both be queued after a busy task.
      // A late load event must not clear the deadline and publish stale bytes.
      if (performance.now() >= deadline) { finish(timeout()); return }
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size || bytes.byteLength > limit) {
        finish(new Error('Scientific source size changed or exceeds its budget')); return
      }
      finish(undefined,bytes)
    }
    reader.onerror = () => finish(reader.error ?? new Error('Scientific source could not be read'))
    reader.onabort = () => finish(new DOMException('Source read cancelled','AbortError'))
    const timer = setTimeout(() => finish(timeout()),Math.max(0,deadline-performance.now()))
    if (signal.aborted) { cancel(); return }
    if (performance.now() >= deadline) { finish(timeout()); return }
    try { reader.readAsArrayBuffer(file) } catch (error) { finish(error) }
  })
}
