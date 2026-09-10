/** Coalesce all scene changes into one scheduled draw. Capture is the one
 * synchronous flush: screenshots must include mutations from the same turn. */
export function createFrameInvalidator(draw: () => void, request: (callback: FrameRequestCallback) => number = requestAnimationFrame, cancel: (id: number) => void = cancelAnimationFrame) {
  let pending: number | null = null, disposed = false
  return {
    invalidate() {
      if (disposed || pending !== null) return
      pending = request(() => { pending = null; if (!disposed) draw() })
    },
    flush() { if (disposed) return; if (pending !== null) cancel(pending); pending = null; draw() },
    dispose() { disposed = true; if (pending !== null) cancel(pending); pending = null },
  }
}
