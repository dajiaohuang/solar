// Offline, explicit restricted-model experiment. No data retrieval/publication.
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../src/engine/dynamics/de440Dynamics.ts'
import { integrateDynamicsExperiment, parseDynamicsInitial } from '../src/engine/dynamics/experiment.ts'

import { readScientificFile, writeScientificReceipt } from './lib/scientific-file.mjs'

const root = new URL('../', import.meta.url)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

export async function runDynamicsFile(sourcePath, outputPath, { durationSeconds, exclusionKm, signal, compareRefinement = false, solarRelativity = false, adoptSolarRadiationPressure = false }) {
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365 * 86400 || !Number.isFinite(exclusionKm) || exclusionKm < 0) throw new RangeError('Experiment requires finite duration within 365 days and a nonnegative explicit exclusion distance')
  const read = (path, limit = 2 * 1024 * 1024) => readScientificFile(path, limit, { signal })
  const bytes = await read(sourcePath)
  const initial = parseDynamicsInitial(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  if (typeof adoptSolarRadiationPressure !== 'boolean' || Boolean(initial.solarRadiationPressure) !== adoptSolarRadiationPressure) throw new RangeError('Solar radiation pressure parameters and explicit adoption must both be present, or both absent')
  if (signal?.aborted) throw new DOMException('Experiment cancelled', 'AbortError')
  const [kernel, gmText] = await Promise.all([readScientificFile(new URL(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`, root), DE440_DYNAMICS_SOURCE.bytes, { signal, exactBytes: DE440_DYNAMICS_SOURCE.bytes }), read(new URL('src/data/gm_de440.tpc', root), 1024 * 1024).then(bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes))])
  const dynamics = await createDe440Dynamics({ spkBytes: kernel.buffer.slice(kernel.byteOffset, kernel.byteOffset + kernel.byteLength), gmText,
    referenceEpochTdb: initial.referenceEpochTdb, elapsedRangeSeconds: [Math.min(0, durationSeconds), Math.max(0, durationSeconds)],
    exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, exclusionKm])), solarRelativity, solarRadiationPressure: initial.solarRadiationPressure })
  const result = await integrateDynamicsExperiment(dynamics, initial.initial, durationSeconds, signal, compareRefinement)
  const implementationSha256 = { 'scripts/lib/scientific-file.mjs': sha(await read(new URL('scripts/lib/scientific-file.mjs', root))) }
  implementationSha256['src/engine/dynamics/solarRadiationPressure.ts'] = sha(await read(new URL('src/engine/dynamics/solarRadiationPressure.ts', root)))
  implementationSha256['src/engine/dynamics/sampleFailure.ts'] = sha(await read(new URL('src/engine/dynamics/sampleFailure.ts', root)))
  for (const path of ['scripts/run-dynamics.mjs', 'src/engine/dynamics/experiment.ts', 'src/engine/dynamics/trajectorySamples.ts', 'src/engine/dynamics/de440Dynamics.ts', 'src/engine/dynamics/de440Source.ts', 'src/engine/dynamics/solarRelativity.ts', 'src/engine/dynamics/adaptiveIntegrator.ts', 'src/engine/dynamics/pointMassGravity.ts', 'src/engine/ephemeris/spk.ts', 'src/engine/ephemeris/spkType17.ts', 'src/engine/ephemeris/spkType21.ts']) implementationSha256[path] = sha(await read(new URL(path, root)))
  implementationSha256['src/engine/ephemeris/osculating.ts'] = sha(await read(new URL('src/engine/ephemeris/osculating.ts', root)))
  const receipt = { schemaVersion: 1, calculation: initial.solarRadiationPressure ? 'restricted-de440-radial-srp-experiment' : solarRelativity ? 'restricted-de440-solar-1pn-experiment' : 'restricted-newtonian-de440-experiment',
    initialFile: { sha256: sha(bytes), bytes: bytes.length, originalBase64: bytes.toString('base64'), payload: initial.payload }, implementationSha256, ...result }
  if (signal?.aborted) throw new DOMException('Experiment cancelled', 'AbortError')
  const publication = await writeScientificReceipt(outputPath, JSON.stringify(receipt, null, 2), { signal })
  return { ...publication, elapsedTdbSeconds: durationSeconds, acceptedSteps: result.numerics.accepted, forceEvaluations: result.numerics.evaluations }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output, adoption, durationFlag, duration, exclusionFlag, exclusion, ...extra] = process.argv.slice(2)
  if (!source || !output || adoption !== '--adopt-de440-point-masses' || durationFlag !== '--duration-seconds' || exclusionFlag !== '--exclusion-km' || !duration || !exclusion || new Set(extra).size !== extra.length || extra.some(flag => !['--compare-refinement', '--adopt-solar-1pn', '--adopt-solar-radiation-pressure'].includes(flag))) throw new Error('Usage: node --experimental-strip-types scripts/run-dynamics.mjs <initial.json> <new-output.json> --adopt-de440-point-masses --duration-seconds <signed-seconds> --exclusion-km <distance> [--compare-refinement] [--adopt-solar-1pn] [--adopt-solar-radiation-pressure]')
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  try { console.log(JSON.stringify(await runDynamicsFile(source, output, { durationSeconds: Number(duration), exclusionKm: Number(exclusion), signal: controller.signal, compareRefinement: extra.includes('--compare-refinement'), solarRelativity: extra.includes('--adopt-solar-1pn'), adoptSolarRadiationPressure: extra.includes('--adopt-solar-radiation-pressure') }), null, 2)) }
  finally { process.off('SIGINT', cancel) }
}
