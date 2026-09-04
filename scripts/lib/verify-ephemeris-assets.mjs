import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/** Verify the exact packaged set, not just an interchangeable total byte count. */
export async function verifyEphemerisAssets(directory, files) {
  const expected = files.map(file => file.path).sort()
  if (new Set(expected).size !== expected.length || expected.some(path => !/^[\w.-]+\.bsp$/.test(path))) throw new Error('Invalid ephemeris manifest paths')
  const actual = (await readdir(directory)).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Ephemeris package file set differs from pinned manifest')
  let total = 0
  for (const file of files) {
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 128 * 1024 * 1024) throw new Error('Invalid ephemeris file size limit')
    const bytes = await readFile(join(directory, file.path))
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Ephemeris package integrity mismatch: ${file.path}`)
    total += bytes.length
  }
  return total
}
