// Explicit, bounded source ingestion. One request at a time follows the JPL
// fair-use policy. No deployment, release publication or orbit propagation.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSbdbCovariance } from '../src/data/loaders/sbdbCovariance.ts'

const MAX_BYTES = 2 * 1024 * 1024
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function covarianceUrl(designation) {
  if (typeof designation !== 'string' || !designation.trim() || designation.length > 80 || /[\x00-\x1f\x7f]/.test(designation)) throw new Error('Provide one unambiguous SBDB designation')
  const url = new URL('https://ssd-api.jpl.nasa.gov/sbdb.api')
  for (const [key, value] of Object.entries({ des: designation.trim(), cov: 'mat', 'full-prec': '1', 'phys-par': '1', 'orbit-defs': '1', 'nv-fmt': 'jd' })) url.searchParams.set(key, value)
  return url.href
}

async function writeImmutable(path, bytes) {
  try { await writeFile(path, bytes, { flag: 'wx' }) }
  catch (error) {
    if (error.code !== 'EEXIST' || !Buffer.from(await readFile(path)).equals(Buffer.from(bytes))) throw error
  }
}

export async function fetchCovariance(designation, outputDirectory = '.cache/sbdb-covariance', fetcher = fetch) {
  const url = covarianceUrl(designation), response = await fetcher(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' })
  if (!response.ok) throw new Error(`JPL SBDB returned HTTP ${response.status}`)
  if (!response.body) throw new Error('JPL SBDB returned an empty body')
  const reader = response.body.getReader(), chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) throw new Error(`SBDB response exceeds ${MAX_BYTES} bytes`)
      chunks.push(value)
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  const bytes = Buffer.concat(chunks), hash = sha256(bytes)
  const parsed = parseSbdbCovariance(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  const directory = resolve(outputDirectory)
  await mkdir(directory, { recursive: true })
  const sourcePath = resolve(directory, `${hash}.json`)
  await writeImmutable(sourcePath, bytes)
  const receipt = { schemaVersion: 1, source: 'NASA/JPL SBDB API', url, retrievedAt: new Date().toISOString(),
    sourceSha256: hash, sourceBytes: size, sourcePath: `${hash}.json`,
    format: 'cov=mat;full-prec=1', audit: parsed,
    boundary: 'Source covariance at its solution epoch only. No state propagation, event probability or physical prediction accuracy has been established.' }
  // Retrieval times vary even when source bytes do not. Address the receipt by
  // its own bytes; do not overwrite an earlier source acquisition record.
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)
  const receiptPath = resolve(directory, `${hash}-${sha256(receiptBytes)}.receipt.json`)
  await writeImmutable(receiptPath, receiptBytes)
  return { sourcePath, receiptPath, sourceSha256: hash, designation: parsed.designation,
    solutionId: parsed.solutionId, solutionEpochTdb: parsed.solutionEpochTdb, dimension: parsed.labels.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length < 1 || args.length > 2) throw new Error('Usage: node --experimental-strip-types scripts/fetch-sbdb-covariance.mjs <designation> [output-directory]')
  console.log(JSON.stringify(await fetchCovariance(args[0], args[1]), null, 2))
}
