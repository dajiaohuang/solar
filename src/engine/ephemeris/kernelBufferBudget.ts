// Raw SPK buffers only: parser metadata, hashing/transport scratch and GPU
// allocations are separate. In the window this also charges managed workers.
const MAX_KERNEL_BUFFER_BYTES = 512 * 1024 * 1024
let reservedBytes = 0

export function reserveKernelBuffers(bytes: number): () => void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid ephemeris buffer reservation')
  if (bytes > MAX_KERNEL_BUFFER_BYTES - reservedBytes) {
    throw new Error('Ephemeris kernel buffer budget exceeded (512 MiB including managed workers)')
  }
  reservedBytes += bytes
  let released = false
  return () => {
    if (released) return
    released = true
    reservedBytes -= bytes
  }
}
