// Offline, explicit restricted-model experiment. No data retrieval/publication.
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../src/engine/dynamics/de440Dynamics.ts'
import { integrateAdaptive } from '../src/engine/dynamics/adaptiveIntegrator.ts'
import { withIdentityTransition } from '../src/engine/dynamics/pointMassGravity.ts'

const root = new URL('../', import.meta.url)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

export async function runDynamicsFile(sourcePath, outputPath, { durationSeconds, exclusionKm, signal }) {
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365 * 86400 || !Number.isFinite(exclusionKm) || exclusionKm < 0) throw new RangeError('Experiment requires finite duration within 365 days and a nonnegative explicit exclusion distance')
  if ((await stat(sourcePath)).size > 2 * 1024 * 1024) throw new RangeError('Initial condition file exceeds 2 MiB')
  const bytes = await readFile(sourcePath)
  if (bytes.length > 2 * 1024 * 1024) throw new RangeError('Initial condition file exceeds 2 MiB')
  const initial = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (initial.schemaVersion !== 1 || initial.frame !== 'J2000' || initial.origin !== 'SSB' || initial.timeScale !== 'TDB' ||
      !Number.isFinite(initial.referenceEpochTdb) || !Array.isArray(initial.initial) || initial.initial.length !== 6 || !initial.initial.every(Number.isFinite) ||
      typeof initial.initialSource !== 'string' || !initial.initialSource.trim()) throw new RangeError('Expected explicit J2000/SSB/TDB initial state in km and km/s with source description')
  if (signal?.aborted) throw new DOMException('Experiment cancelled', 'AbortError')
  const [kernel, gmText] = await Promise.all([readFile(new URL(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`, root)), readFile(new URL('src/data/gm_de440.tpc', root), 'utf8')])
  const dynamics = await createDe440Dynamics({ spkBytes: kernel.buffer.slice(kernel.byteOffset, kernel.byteOffset + kernel.byteLength), gmText,
    referenceEpochTdb: initial.referenceEpochTdb, elapsedRangeSeconds: [Math.min(0, durationSeconds), Math.max(0, durationSeconds)],
    exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, exclusionKm])) })
  const absoluteTolerance = new Float64Array(42).fill(1e-12)
  absoluteTolerance.fill(1e-5, 0, 3)
  const result = await integrateAdaptive({ initial: withIdentityTransition(initial.initial), duration: durationSeconds,
    derivative: dynamics.derivative, absoluteTolerance, relativeTolerance: 1e-12, initialStep: 3600, maxStep: 86400, maxAttempts: 20000, signal })
  const implementationSha256 = {}
  for (const path of ['scripts/run-dynamics.mjs', 'src/engine/dynamics/de440Dynamics.ts', 'src/engine/dynamics/adaptiveIntegrator.ts', 'src/engine/dynamics/pointMassGravity.ts', 'src/engine/ephemeris/spk.ts', 'src/engine/ephemeris/spkType17.ts', 'src/engine/ephemeris/spkType21.ts']) implementationSha256[path] = sha(await readFile(new URL(path, root)))
  const { state, ...numerics } = result
  const receipt = { schemaVersion: 1, calculation: 'restricted-newtonian-de440-experiment',
    initialFile: { sha256: sha(bytes), bytes: bytes.length, payload: initial },
    forceModel: dynamics.evidence, implementationSha256,
    finalEpoch: { referenceEpochTdb: initial.referenceEpochTdb, elapsedTdbSeconds: durationSeconds },
    finalStateKmKmPerSecond: Array.from(state.subarray(0, 6)),
    transitionMatrix: { layout: 'row-major; d(final J2000 SSB state)/d(initial J2000 SSB state)', dimension: 6, values: Array.from(state.subarray(6)) },
    numerics: { ...numerics, absoluteTolerance: Array.from(numerics.absoluteTolerance) },
    uncertainty: 'Not computed. A fixed-parameter transition matrix is not the complete source-fit covariance.' }
  if (signal?.aborted) throw new DOMException('Experiment cancelled', 'AbortError')
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
  return { outputPath: resolve(outputPath), elapsedTdbSeconds: durationSeconds, acceptedSteps: result.accepted, forceEvaluations: result.evaluations }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output, adoption, durationFlag, duration, exclusionFlag, exclusion, ...extra] = process.argv.slice(2)
  if (!source || !output || adoption !== '--adopt-de440-point-masses' || durationFlag !== '--duration-seconds' || exclusionFlag !== '--exclusion-km' || !duration || !exclusion || extra.length) throw new Error('Usage: node --experimental-strip-types scripts/run-dynamics.mjs <initial.json> <new-output.json> --adopt-de440-point-masses --duration-seconds <signed-seconds> --exclusion-km <distance>')
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  try { console.log(JSON.stringify(await runDynamicsFile(source, output, { durationSeconds: Number(duration), exclusionKm: Number(exclusion), signal: controller.signal }), null, 2)) }
  finally { process.off('SIGINT', cancel) }
}
