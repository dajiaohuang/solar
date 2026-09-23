// Explicit development calculation. Does not fetch, publish or deploy anything.
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSbdbCovariance } from '../src/data/loaders/sbdbCovariance.ts'
import { cartesianCovarianceAtSolutionEpoch } from '../src/engine/ephemeris/orbitCovariance.ts'
import { sampleSbdbCovariance } from '../src/engine/ephemeris/covarianceSampling.ts'

const sha = value => createHash('sha256').update(value).digest('hex')
const root = new URL('../', import.meta.url)

export async function convertCovarianceFile(sourcePath, outputPath, sampling) {
  if ((await stat(sourcePath)).size > 2 * 1024 * 1024) throw new Error('SBDB input exceeds 2 MiB')
  const bytes = await readFile(sourcePath)
  if (bytes.length > 2 * 1024 * 1024) throw new Error('SBDB input exceeds 2 MiB')
  const parsed = parseSbdbCovariance(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  const gmBytes = await readFile(new URL('src/data/gm_de440.tpc', root)), gmHash = sha(gmBytes)
  if (gmHash !== '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140') throw new Error('Pinned DE440 GM source hash mismatch')
  const match = gmBytes.toString('utf8').match(/BODY10_GM\s*=\s*\(\s*([\d.Ee+-]+)/)
  if (!match) throw new Error('Missing solar GM in the pinned source')
  const km3PerSecond2 = Number(match[1]), au3PerDay2 = km3PerSecond2 * 86400 ** 2 / 149597870.7 ** 3
  const result = cartesianCovarianceAtSolutionEpoch(parsed, { au3PerDay2,
    source: 'Explicitly adopted DE440 solar GM; not asserted to reproduce the SBDB orbit-fit force model' })
  const samples = sampling ? sampleSbdbCovariance(parsed, sampling.count, sampling.seed) : undefined
  const implementation = {}
  for (const path of ['src/data/loaders/sbdbCovariance.ts', 'src/engine/ephemeris/orbitCovariance.ts', 'src/engine/ephemeris/kepler.ts', 'src/engine/ephemeris/covarianceSampling.ts']) implementation[path] = sha(await readFile(new URL(path, root)))
  const receipt = { schemaVersion: 1, calculation: 'solution-epoch-coordinate-covariance',
    sourceSha256: sha(bytes), sourceBytes: bytes.length, sourceAudit: parsed,
    adoptedGM: { url: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc', sha256: gmHash, km3PerSecond2 },
    implementationSha256: implementation, result,
    sampling: samples ? { ...samples, offsets: Array.from(samples.offsets), layout: 'row-major; one joint parameter-offset vector per sample' } : undefined }
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
  return { outputPath: resolve(outputPath), sourceSha256: receipt.sourceSha256, dimension: result.labels.length,
    epochTdb: result.epochTdb, limitation: result.limitations[0] }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output, adoption, ...extra] = process.argv.slice(2)
  if (!source || !output || adoption !== '--adopt-de440-gm' || extra.length && (extra.length !== 4 || extra[0] !== '--samples' || extra[2] !== '--seed')) throw new Error('Usage: node --experimental-strip-types scripts/convert-sbdb-covariance.mjs <response.json> <new-output.json> --adopt-de440-gm [--samples <1..10000> --seed <uint32>]')
  const sampling = extra.length ? { count: Number(extra[1]), seed: Number(extra[3]) } : undefined
  console.log(JSON.stringify(await convertCovarianceFile(source, output, sampling), null, 2))
}
