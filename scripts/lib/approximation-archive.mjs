import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createGzip, createGunzip } from 'node:zlib'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInterface } from 'node:readline'
import { verifyApproximationAssets } from './verify-approximation-assets.mjs'

const hashFile = async path => {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex')
}
export async function packApproximationArchive(root, destination) {
  const { manifest } = await verifyApproximationAssets(root)
  async function* records() {
    yield `${JSON.stringify({ format: 'solar-approximation-archive-v1', manifest })}\n`
    for (const body of manifest.bodies) for (const chunk of body.chunks) {
      if (chunk.encoding || chunk.path.endsWith('.gz')) throw new Error('Archive input must be the original JSON fit archive')
      yield `${JSON.stringify({ path: chunk.path, data: (await readFile(join(root, chunk.path))).toString('base64') })}\n`
    }
  }
  await pipeline(Readable.from(records()), createGzip({ level: 6 }), createWriteStream(destination, { flags: 'wx' }))
  return { sha256: await hashFile(destination), sourceManifestSha256: manifest.sourceManifestSha256 }
}

export async function installApproximationArchive(archive, expectedSha256, destination) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || await hashFile(archive) !== expectedSha256) throw new Error('Approximation archive SHA-256 mismatch')
  let total = 0, line = 0
  const guard = new Transform({ transform(bytes, _encoding, callback) {
    total += bytes.length
    if (total > 4 * 1024 ** 3) return callback(new Error('Approximation archive exceeds decompressed budget'))
    for (const byte of bytes) {
      if (byte === 10) line = 0
      else if (++line > 24 * 1048576) return callback(new Error('Approximation archive record exceeds byte budget'))
    }
    callback(null, bytes)
  } })
  const stream = guard
  const completed = pipeline(createReadStream(archive), createGunzip(), guard)
  completed.catch(() => {}) // Awaited below; keep early failures handled too.
  const expected = new Map(), received = new Set()
  let manifest
  try {
    for await (const text of createInterface({ input: stream, crlfDelay: Infinity })) {
      const record = JSON.parse(text)
      if (!manifest) {
        if (record.format !== 'solar-approximation-archive-v1' || !Array.isArray(record.manifest?.bodies)) throw new Error('Invalid approximation archive header')
        manifest = record.manifest
        for (const body of manifest.bodies) for (const chunk of body.chunks) {
          if (!/^chunks\/[a-zA-Z0-9%._-]+\.json$/.test(chunk.path) || expected.has(chunk.path)
            || !Number.isSafeInteger(chunk.bytes) || chunk.bytes <= 0 || chunk.bytes > 16 * 1048576
            || !/^[a-f0-9]{64}$/.test(chunk.sha256)) throw new Error('Unsafe approximation archive descriptor')
          expected.set(chunk.path, chunk)
        }
        if (expected.size > 65536) throw new Error('Approximation archive file budget exceeded')
        await mkdir(join(destination, 'chunks'), { recursive: true })
        continue
      }
      const descriptor = expected.get(record.path)
      if (!descriptor || received.has(record.path) || typeof record.data !== 'string') throw new Error('Unexpected approximation archive record')
      const bytes = Buffer.from(record.data, 'base64')
      if (bytes.length !== descriptor.bytes || bytes.toString('base64') !== record.data
        || createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) throw new Error('Approximation archive record checksum mismatch')
      const path = join(destination, record.path)
      try { await writeFile(path, bytes, { flag: 'wx' }) }
      catch (error) {
        if (error.code !== 'EEXIST') throw error
        if (!(await readFile(path)).equals(bytes)) throw new Error('Existing archive checkpoint differs')
      }
      received.add(record.path)
    }
    await completed
    if (!manifest || received.size !== expected.size) throw new Error('Truncated approximation archive')
    await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2))
    await verifyApproximationAssets(destination)
  } finally { stream.destroy(); await completed.catch(() => {}) }
  return manifest
}

export async function downloadApproximationArchive(url, sha256, directory) {
  if (!/^https:\/\//.test(url) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Archive URL and SHA-256 must be explicitly pinned')
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${sha256}.ndjson.gz`)
  try { if (await hashFile(path) === sha256) return path; throw new Error('Cached archive digest differs') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60 * 1000) })
  if (!response.ok || !response.body || !response.url.startsWith('https://')) throw new Error(`Approximation archive HTTP ${response.status}`)
  let bytes = 0
  const hash = createHash('sha256'), temporary = `${path}.${process.pid}.partial`
  await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length
    if (bytes > 1_500_000_000) return callback(new Error('Compressed archive exceeds download budget'))
    hash.update(chunk); callback(null, chunk)
  } }), createWriteStream(temporary, { flags: 'wx' }))
  if (hash.digest('hex') !== sha256) throw new Error('Downloaded approximation archive SHA-256 mismatch')
  await rename(temporary, path)
  return path
}
