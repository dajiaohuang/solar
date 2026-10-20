import { link, mkdtemp, open, rmdir, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Bounded regular-file snapshot. Cancellation is observed between OS reads;
 * it cannot preempt an OS read already in progress. Source hashes remain the
 * authority for pinned inputs; metadata checks alone do not authenticate data.
 */
export async function readScientificFile(path, maxBytes, { signal, exactBytes } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 128 * 1024 * 1024 ||
      exactBytes !== undefined && (!Number.isSafeInteger(exactBytes) || exactBytes < 1 || exactBytes > maxBytes)) {
    throw new RangeError('Invalid scientific file byte budget')
  }
  signal?.throwIfAborted()
  const handle = await open(path, 'r')
  try {
    signal?.throwIfAborted()
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.size < 1n || before.size > BigInt(maxBytes) ||
        exactBytes !== undefined && before.size !== BigInt(exactBytes)) {
      throw new RangeError('Scientific input must be a nonempty regular file within its declared byte budget')
    }
    // One sentinel byte detects growth without ever reading an unbounded file.
    const bytes = Buffer.alloc(Number(before.size) + 1)
    let length = 0
    while (length < bytes.length) {
      signal?.throwIfAborted()
      const { bytesRead } = await handle.read(bytes, length, Math.min(65536, bytes.length - length), length)
      signal?.throwIfAborted()
      if (!bytesRead) break
      length += bytesRead
    }
    const after = await handle.stat({ bigint: true })
    signal?.throwIfAborted()
    if (BigInt(length) !== before.size || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw new Error('Scientific input changed during reading; no snapshot was accepted')
    }
    return bytes.subarray(0, length)
  } finally {
    await handle.close()
  }
}

/** Publish a completed local receipt without replacing an existing path.
 * The hard-link creation is the commit point: cancellation after it succeeds
 * does not roll back a valid output. Filesystems without hard links fail closed.
 * File sync is requested; directory/crash durability is not asserted.
 */
export async function writeScientificReceipt(outputPath, json, { signal, maxBytes = 32 * 1024 * 1024 } = {}) {
  signal?.throwIfAborted()
  if (typeof json !== 'string' || !json.length || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 128 * 1024 * 1024) {
    throw new RangeError('Invalid receipt text or byte budget')
  }
  const length = Buffer.byteLength(json, 'utf8') + 1
  if (length > maxBytes) throw new RangeError('Scientific receipt exceeds output byte budget')
  // Serialization occurs at the caller; this bounds the additional byte buffer.
  const bytes = Buffer.from(json + '\n', 'utf8'), destination = resolve(outputPath)
  signal?.throwIfAborted()
  const directory = await mkdtemp(join(dirname(destination), '.solar-receipt-'))
  const temporary = join(directory, 'receipt.json')
  let handle, ownedFile = false, published = false, failure
  const cleanupWarnings = []
  try {
    signal?.throwIfAborted()
    handle = await open(temporary, 'wx', 0o600)
    ownedFile = true
    for (let offset = 0; offset < bytes.length;) {
      signal?.throwIfAborted()
      const { bytesWritten } = await handle.write(bytes, offset, Math.min(65536, bytes.length - offset), offset)
      if (bytesWritten <= 0) throw new Error('Scientific receipt write made no progress')
      offset += bytesWritten
    }
    signal?.throwIfAborted()
    await handle.sync()
    await handle.close()
    handle = undefined
    signal?.throwIfAborted()
    // Same-directory filesystem; link fails with EEXIST for an existing output.
    // Never fall back to rename, which can overwrite a racing destination.
    await link(temporary, destination)
    published = true
  } catch (error) {
    failure = error
  } finally {
    if (handle) {
      try { await handle.close() } catch (error) { cleanupWarnings.push(`Close ${temporary}: ${String(error)}`) }
    }
    if (ownedFile) {
      try { await unlink(temporary) } catch (error) { if (error.code !== 'ENOENT') cleanupWarnings.push(`Remove ${temporary}: ${String(error)}`) }
    }
    // Only the directory created by this invocation, and only if empty.
    try { await rmdir(directory) } catch (error) { if (error.code !== 'ENOENT') cleanupWarnings.push(`Remove ${directory}: ${String(error)}`) }
  }
  if (!published) {
    const error = new Error(`Scientific receipt was not published to ${destination}`, { cause: failure })
    error.outputPublished = false
    error.cleanupWarnings = cleanupWarnings
    throw error
  }
  return { outputPath: destination, outputBytes: bytes.length, cleanupWarnings }
}
