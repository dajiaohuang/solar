import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Transform, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'

export const SOURCE_URLS = {
  metadata: 'https://ssd.jpl.nasa.gov/dat/elem_files.json',
  numbered: 'https://ssd.jpl.nasa.gov/dat/ELEMENTS.NUMBR.gz',
  unnumbered: 'https://ssd.jpl.nasa.gov/dat/ELEMENTS.UNNUM.gz',
  comets: 'https://ssd.jpl.nasa.gov/dat/ELEMENTS.COMET',
  planetarySatellites: 'https://ssd.jpl.nasa.gov/sats/discovery.html',
  smallBodySatellites: 'https://ssd-api.jpl.nasa.gov/sb_sat.api?orb=1&phys-par=1&fullname=1',
}
export const SOURCE_FILES = { metadata: 'elem_files.json', numbered: 'ELEMENTS.NUMBR.gz', unnumbered: 'ELEMENTS.UNNUM.gz', comets: 'ELEMENTS.COMET', planetarySatellites: 'planetary-satellites.html', smallBodySatellites: 'small-body-satellites.json' }
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export async function hashFile(path) {
  const hash = createHash('sha256'); let bytes = 0
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length }
  return { sha256: hash.digest('hex'), bytes }
}
async function request(url, method = 'GET') {
  // All callers await each request. No concurrent requests to SSD APIs.
  const response = await fetch(url, { method, signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Source HTTP ${response.status}: ${url}; retry the command later with a new snapshot directory`)
  return response
}
const validators = (response) => ({ etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') })

export async function downloadSnapshot(directory) {
  // Exclusive directory creation prevents accidental replacement of evidence.
  await mkdir(directory)
  const sources = {}
  for (const [key, url] of Object.entries(SOURCE_URLS)) {
    const startedAt = new Date().toISOString(), response = await request(url)
    let size = 0
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length
      callback(size > 150_000_000 ? new Error('Source exceeds bounded download size') : null, chunk)
    } }), createWriteStream(join(directory, SOURCE_FILES[key]), { flags: 'wx' }))
    sources[key] = { file: SOURCE_FILES[key], url, startedAt, completedAt: new Date().toISOString(), ...validators(response), ...await hashFile(join(directory, SOURCE_FILES[key])) }
  }
  const metadata = await readFile(join(directory, SOURCE_FILES.metadata))
  if (digest(Buffer.from(await (await request(SOURCE_URLS.metadata)).arrayBuffer())) !== digest(metadata)) throw new Error('Element metadata changed during download; snapshot not published')
  for (const key of ['numbered', 'unnumbered', 'comets', 'planetarySatellites']) {
    const after = validators(await request(SOURCE_URLS[key], 'HEAD')), before = sources[key]
    if (after.etag !== before.etag || after.lastModified !== before.lastModified) throw new Error(`Source changed during snapshot: ${key}`)
    if (!before.etag && !before.lastModified) throw new Error(`Source lacks refresh validators: ${key}`)
  }
  const snapshot = { schemaVersion: 1, sources, consistency: 'Per-file SHA-256 plus before/after static validators; API response is a separate point-in-time snapshot, not an atomic shared database transaction.' }
  await writeFile(join(directory, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' })
  return snapshot
}

export async function verifySnapshot(directory) {
  const snapshot = JSON.parse(await readFile(join(directory, 'snapshot.json'), 'utf8'))
  if (snapshot.schemaVersion !== 1 || !snapshot.sources || Object.keys(snapshot.sources).length !== Object.keys(SOURCE_FILES).length) throw new Error('Invalid source snapshot')
  for (const [key, file] of Object.entries(SOURCE_FILES)) {
    const source = snapshot.sources[key]
    if (!source || source.file !== file || source.url !== SOURCE_URLS[key]) throw new Error(`Invalid source mapping: ${key}`)
    const actual = await hashFile(join(directory, file))
    if (actual.bytes !== source.bytes || actual.sha256 !== source.sha256) throw new Error(`Source integrity mismatch: ${key}`)
  }
  return snapshot
}
