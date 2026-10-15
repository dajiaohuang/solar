// Offline conditional covariance experiment; no source retrieval or publication.
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSbdbCovariance } from '../src/data/loaders/sbdbCovariance.ts'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../src/engine/dynamics/de440Dynamics.ts'
import { propagateDynamicsCovariance } from '../src/engine/dynamics/covariancePropagation.ts'

import { readScientificFile, writeScientificReceipt } from './lib/scientific-file.mjs'

const root = new URL('../', import.meta.url)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

export async function propagateCovarianceFile(sourcePath, outputPath, { durationSeconds, exclusionKm, solarRelativity = false, compareRefinement = false, signal }) {
  if (typeof compareRefinement !== 'boolean') throw new RangeError('Covariance refinement adoption must be boolean')
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365*86400 || !Number.isFinite(exclusionKm) || exclusionKm < 0) throw new RangeError('Require finite duration within 365 days and an explicit nonnegative exclusion distance')
  const read = (path, limit = 2 * 1024 * 1024) => readScientificFile(path, limit, { signal })
  const bytes = await read(sourcePath)
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const source = parseSbdbCovariance(payload)
  if (source.labels.length !== 6) throw new RangeError('Additional fitted or considered source parameters require matched force derivatives; no axes will be dropped')
  if (signal?.aborted) throw new DOMException('Propagation cancelled', 'AbortError')
  const [kernel, gmText] = await Promise.all([readScientificFile(new URL(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`, root), DE440_DYNAMICS_SOURCE.bytes, { signal, exactBytes: DE440_DYNAMICS_SOURCE.bytes }), read(new URL('src/data/gm_de440.tpc', root), 1024 * 1024).then(bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes))])
  const dynamics = await createDe440Dynamics({ spkBytes: kernel.buffer.slice(kernel.byteOffset, kernel.byteOffset+kernel.byteLength), gmText,
    referenceEpochTdb: source.solutionEpochTdb, elapsedRangeSeconds: [Math.min(0, durationSeconds), Math.max(0, durationSeconds)],
    exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, exclusionKm])), solarRelativity })
  const result = await propagateDynamicsCovariance(dynamics, source, durationSeconds, signal, compareRefinement)
  const implementationSha256 = { 'scripts/lib/scientific-file.mjs': sha(await read(new URL('scripts/lib/scientific-file.mjs', root))) }
  for (const path of ['scripts/propagate-sbdb-covariance.mjs', 'src/data/loaders/sbdbCovariance.ts', 'src/engine/dynamics/covariancePropagation.ts',
    'src/engine/ephemeris/covarianceSampling.ts', 'src/engine/ephemeris/orbitCovariance.ts', 'src/engine/ephemeris/orbitalPeriodUncertainty.ts', 'src/engine/ephemeris/conicCovariancePlane.ts', 'src/engine/ephemeris/kepler.ts',
    'src/engine/dynamics/experiment.ts', 'src/engine/dynamics/trajectorySamples.ts', 'src/engine/dynamics/de440Dynamics.ts', 'src/engine/dynamics/de440Source.ts',
    'src/engine/dynamics/solarRelativity.ts', 'src/engine/dynamics/adaptiveIntegrator.ts', 'src/engine/dynamics/pointMassGravity.ts',
    'src/engine/ephemeris/spk.ts', 'src/engine/ephemeris/spkType17.ts', 'src/engine/ephemeris/spkType21.ts', 'src/engine/ephemeris/osculating.ts']) {
    implementationSha256[path] = sha(await read(new URL(path, root)))
  }
  const receipt = { schemaVersion: 1, calculation: 'conditional-six-parameter-de440-covariance',
    sourceFile: { sha256: sha(bytes), bytes: bytes.length, originalBase64: bytes.toString('base64'), payload }, implementationSha256, ...result }
  if (signal?.aborted) throw new DOMException('Propagation cancelled', 'AbortError')
  const publication = await writeScientificReceipt(outputPath, JSON.stringify(receipt, null, 2), { signal })
  return { ...publication, elapsedTdbSeconds: durationSeconds, acceptedSteps: result.experiment.numerics.accepted,
    finalMarginalSigmas: result.finalCoordinates.marginalSigmas, units: result.finalCoordinates.units,
    refinementCompared: result.covarianceRefinement !== null,
    marginalSigmaAbsoluteDifference: result.covarianceRefinement?.marginalSigmaAbsoluteDifference ?? null }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output, adoption, durationFlag, duration, exclusionFlag, exclusion, ...extra] = process.argv.slice(2)
  if (!source || !output || adoption !== '--adopt-conditional-de440-model' || durationFlag !== '--duration-seconds' || exclusionFlag !== '--exclusion-km' || !duration || !exclusion || new Set(extra).size !== extra.length || extra.some(flag => !['--adopt-solar-1pn', '--compare-refinement'].includes(flag))) throw new Error('Usage: node --experimental-strip-types scripts/propagate-sbdb-covariance.mjs <sbdb.json> <new-output.json> --adopt-conditional-de440-model --duration-seconds <signed-seconds> --exclusion-km <distance> [--adopt-solar-1pn] [--compare-refinement]')
  const controller = new AbortController(), cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  try { console.log(JSON.stringify(await propagateCovarianceFile(source, output, { durationSeconds: Number(duration), exclusionKm: Number(exclusion), solarRelativity: extra.includes('--adopt-solar-1pn'), compareRefinement: extra.includes('--compare-refinement'), signal: controller.signal }), null, 2)) }
  finally { process.off('SIGINT', cancel) }
}
