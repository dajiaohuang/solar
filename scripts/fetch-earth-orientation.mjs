import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

// Development ingestion only. No dataset publication or application deployment.
const sourceUrl = 'https://data.iers.org/products/eop/rapid/standard/finals2000A.all'
const directory = resolve(process.argv[2] ?? '.cache/earth-orientation')
const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000), headers: {
  'User-Agent': 'SolarAtlas/0.11.0 (https://github.com/dajiaohuang/solar)',
} })
if (!response.ok) throw new Error(`IERS HTTP ${response.status}`)
const chunks = []
let size = 0
for await (const chunk of response.body) {
  size += chunk.length
  if (size > 8 * 1024 * 1024) throw new Error('IERS source exceeds 8 MiB')
  chunks.push(chunk)
}
const bytes = Buffer.concat(chunks)
if (!/^\s*\d{2}\s*\d{1,2}\s*\d{1,2}\s+\d{5}\.\d{2}/.test(bytes.toString('ascii', 0, 100))) throw new Error('IERS did not return finals2000A records')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const path = `finals2000A-${sha256}.all`
await mkdir(directory, { recursive: true })
const immutableWrite = async (destination, data) => {
  try { await writeFile(destination, data, { flag: 'wx' }) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (!(await readFile(destination)).equals(Buffer.from(data))) throw new Error(`Immutable artifact differs: ${destination}`)
  }
}
await immutableWrite(join(directory, path), bytes)
const manifestPath = join(directory, `iers-${sha256}.json`)
let manifest
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error }
manifest ??= { schemaVersion: 1, sourceUrl, retrievedAt: new Date().toISOString(), sha256, bytes: size, path }
if (manifest.sha256 !== sha256 || manifest.bytes !== size || manifest.path !== path || manifest.sourceUrl !== sourceUrl) throw new Error('Existing IERS manifest disagrees with source')
await immutableWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ manifestPath, sha256, bytes: size, retrievedAt: manifest.retrievedAt }))
