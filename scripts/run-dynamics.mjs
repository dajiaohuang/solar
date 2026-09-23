// Offline, explicit restricted-model experiment. No data retrieval/publication.
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../src/engine/dynamics/de440Dynamics.ts'
import { integrateDynamicsExperiment, parseDynamicsInitial } from '../src/engine/dynamics/experiment.ts'

const root = new URL('../', import.meta.url)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

export async function runDynamicsFile(sourcePath, outputPath, { durationSeconds, exclusionKm, signal, compareRefinement = false, solarRelativity = false }) {
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365 * 86400 || !Number.isFinite(exclusionKm) || exclusionKm < 0) throw new RangeError('Experiment requires finite duration within 365 days and a nonnegative explicit exclusion distance')
  if ((await stat(sourcePath)).size > 2 * 1024 * 1024) throw new RangeError('Initial condition file exceeds 2 MiB')
  const bytes = await readFile(sourcePath)
  if (bytes.length > 2 * 1024 * 1024) throw new RangeError('Initial condition file exceeds 2 MiB')
  const initial = parseDynamicsInitial(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  if (signal?.aborted) throw new DOMException('Experiment cancelled', 'AbortError')
  const [kernel, gmText] = await Promise.all([readFile(new URL(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`, root)), readFile(new URL('src/data/gm_de440.tpc', root), 'utf8')])
  const dynamics = await createDe440Dynamics({ spkBytes: kernel.buffer.slice(kernel.byteOffset, kernel.byteOffset + kernel.byteLength), gmText,
    referenceEpochTdb: initial.referenceEpochTdb, elapsedRangeSeconds: [Math.min(0, durationSeconds), Math.max(0, durationSeconds)],
    exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, exclusionKm])), solarRelativity })
  const result = await integrateDynamicsExperiment(dynamics, initial.initial, durationSeconds, signal, compareRefinement)
  const implementationSha256 = {}
  for (const path of ['scripts/run-dynamics.mjs', 'src/engine/dynamics/experiment.ts', 'src/engine/dynamics/trajectorySamples.ts', 'src/engine/dynamics/de440Dynamics.ts', 'src/engine/dynamics/solarRelativity.ts', 'src/engine/dynamics/adaptiveIntegrator.ts', 'src/engine/dynamics/pointMassGravity.ts', 'src/engine/ephemeris/spk.ts', 'src/engine/ephemeris/spkType17.ts', 'src/engine/ephemeris/spkType21.ts']) implementationSha256[path] = sha(await readFile(new URL(path, root)))
  const receipt = { schemaVersion: 1, calculation: solarRelativity ? 'restricted-de440-solar-1pn-experiment' : 'restricted-newtonian-de440-experiment',
    initialFile: { sha256: sha(bytes), bytes: bytes.length, payload: initial.payload }, implementationSha256, ...result }
  if (signal?.aborted) throw new DOMException('Experiment cancelled', 'AbortError')
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
  return { outputPath: resolve(outputPath), elapsedTdbSeconds: durationSeconds, acceptedSteps: result.numerics.accepted, forceEvaluations: result.numerics.evaluations }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output, adoption, durationFlag, duration, exclusionFlag, exclusion, ...extra] = process.argv.slice(2)
  if (!source || !output || adoption !== '--adopt-de440-point-masses' || durationFlag !== '--duration-seconds' || exclusionFlag !== '--exclusion-km' || !duration || !exclusion || new Set(extra).size !== extra.length || extra.some(flag => !['--compare-refinement', '--adopt-solar-1pn'].includes(flag))) throw new Error('Usage: node --experimental-strip-types scripts/run-dynamics.mjs <initial.json> <new-output.json> --adopt-de440-point-masses --duration-seconds <signed-seconds> --exclusion-km <distance> [--compare-refinement] [--adopt-solar-1pn]')
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  try { console.log(JSON.stringify(await runDynamicsFile(source, output, { durationSeconds: Number(duration), exclusionKm: Number(exclusion), signal: controller.signal, compareRefinement: extra.includes('--compare-refinement'), solarRelativity: extra.includes('--adopt-solar-1pn') }), null, 2)) }
  finally { process.off('SIGINT', cancel) }
}
