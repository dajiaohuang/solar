// Explicit development calculation. Does not fetch, publish or deploy anything.
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSbdbCovariance } from '../src/data/loaders/sbdbCovariance.ts'
import { cartesianCovarianceAtSolutionEpoch } from '../src/engine/ephemeris/orbitCovariance.ts'
import { sampleSbdbCovariance } from '../src/engine/ephemeris/covarianceSampling.ts'
import { covarianceEllipsoid } from '../src/engine/ephemeris/covarianceEllipsoid.ts'
import { readScientificFile, writeScientificReceipt } from './lib/scientific-file.mjs'

const sha = value => createHash('sha256').update(value).digest('hex')
const root = new URL('../', import.meta.url)

export async function convertCovarianceFile(sourcePath, outputPath, sampling, { signal } = {}) {
  const read = (path, limit = 2 * 1024 * 1024) => readScientificFile(path, limit, { signal })
  const bytes = await read(sourcePath)
  const parsed = parseSbdbCovariance(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  const gmBytes = await read(new URL('src/data/gm_de440.tpc', root), 1024 * 1024), gmHash = sha(gmBytes)
  if (gmHash !== '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140') throw new Error('Pinned DE440 GM source hash mismatch')
  const match = gmBytes.toString('utf8').match(/BODY10_GM\s*=\s*\(\s*([\d.Ee+-]+)/)
  if (!match) throw new Error('Missing solar GM in the pinned source')
  const km3PerSecond2 = Number(match[1]), au3PerDay2 = km3PerSecond2 * 86400 ** 2 / 149597870.7 ** 3
  const result = cartesianCovarianceAtSolutionEpoch(parsed, { au3PerDay2,
    source: 'Explicitly adopted DE440 solar GM; not asserted to reproduce the SBDB orbit-fit force model' })
  const samples = sampling ? sampleSbdbCovariance(parsed, sampling.count, sampling.seed) : undefined
  let positionEllipsoid = null, positionEllipsoidError = null
  try { positionEllipsoid = { ...covarianceEllipsoid(result.matrix, 149597870.7), units: 'km', frame: result.frame } }
  catch (reason) { positionEllipsoidError = String(reason) }
  const implementation = {}
  for (const path of ['scripts/convert-sbdb-covariance.mjs', 'scripts/lib/scientific-file.mjs', 'src/data/loaders/sbdbCovariance.ts', 'src/engine/ephemeris/orbitCovariance.ts', 'src/engine/ephemeris/conicCovariancePlane.ts', 'src/engine/ephemeris/kepler.ts', 'src/engine/ephemeris/covarianceSampling.ts']) implementation[path] = sha(await read(new URL(path, root)))
  const receipt = { schemaVersion: 1, calculation: 'solution-epoch-coordinate-covariance',
    positionEllipsoid, positionEllipsoidError,
    sourceSha256: sha(bytes), sourceBytes: bytes.length, originalBase64: bytes.toString('base64'), sourceAudit: parsed,
    adoptedGM: { url: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc', sha256: gmHash, km3PerSecond2 },
    implementationSha256: { ...implementation, 'src/engine/ephemeris/covarianceEllipsoid.ts': sha(await read(new URL('src/engine/ephemeris/covarianceEllipsoid.ts', root))) }, result,
    sampling: samples ? { ...samples, offsets: Array.from(samples.offsets), layout: 'row-major; one joint parameter-offset vector per sample' } : undefined }
  signal?.throwIfAborted()
  const publication = await writeScientificReceipt(outputPath, JSON.stringify(receipt, null, 2), { signal })
  return { ...publication, sourceSha256: receipt.sourceSha256, dimension: result.labels.length,
    epochTdb: result.epochTdb, limitation: result.limitations[0] }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output, adoption, ...extra] = process.argv.slice(2)
  if (!source || !output || adoption !== '--adopt-de440-gm' || extra.length && (extra.length !== 4 || extra[0] !== '--samples' || extra[2] !== '--seed')) throw new Error('Usage: node --experimental-strip-types scripts/convert-sbdb-covariance.mjs <response.json> <new-output.json> --adopt-de440-gm [--samples <1..10000> --seed <uint32>]')
  const sampling = extra.length ? { count: Number(extra[1]), seed: Number(extra[3]) } : undefined
  const controller = new AbortController(), cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  try { console.log(JSON.stringify(await convertCovarianceFile(source, output, sampling, { signal: controller.signal }), null, 2)) }
  finally { process.off('SIGINT', cancel) }
}
