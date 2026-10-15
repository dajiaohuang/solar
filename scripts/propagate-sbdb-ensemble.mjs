// Offline finite source-draw experiment. No retrieval, deployment or publication.
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSbdbCovariance } from '../src/data/loaders/sbdbCovariance.ts'
import { sampleSbdbCovariance } from '../src/engine/ephemeris/covarianceSampling.ts'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../src/engine/dynamics/de440Dynamics.ts'
import { propagateSourceOffsetEnsemble } from '../src/engine/dynamics/nonlinearEnsemble.ts'

import { readScientificFile, writeScientificReceipt } from './lib/scientific-file.mjs'

const root = new URL('../',import.meta.url), sha = bytes => createHash('sha256').update(bytes).digest('hex')

export async function propagateEnsembleFile(sourcePath, outputPath, { durationSeconds, exclusionKm, count, seed, solarRelativity = false, signal }) {
  signal?.throwIfAborted()
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365*86400 || !Number.isFinite(exclusionKm) || exclusionKm < 0 ||
    !Number.isSafeInteger(count) || count < 1 || count > 128 || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || typeof solarRelativity !== 'boolean') throw new RangeError('Require bounded duration, exclusion distance, 1 to 128 samples and unsigned 32-bit seed')
  const read = (path, limit = 2 * 1024 * 1024) => readScientificFile(path, limit, { signal })
  const bytes = await read(sourcePath), length = bytes.length
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const source = parseSbdbCovariance(payload)
  if (source.labels.length !== 6) throw new RangeError('Additional fitted force parameters are unsupported; no axes will be dropped')
  const sampling = sampleSbdbCovariance(source,count,seed)
  const [kernel,gmText] = await Promise.all([readScientificFile(new URL(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`,root), DE440_DYNAMICS_SOURCE.bytes, { signal, exactBytes: DE440_DYNAMICS_SOURCE.bytes }),read(new URL('src/data/gm_de440.tpc',root), 1024 * 1024).then(bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes))])
  signal?.throwIfAborted()
  const dynamics = await createDe440Dynamics({ spkBytes: kernel.buffer.slice(kernel.byteOffset,kernel.byteOffset+kernel.byteLength),gmText,
    referenceEpochTdb: source.solutionEpochTdb,elapsedRangeSeconds: [Math.min(0,durationSeconds),Math.max(0,durationSeconds)],
    exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id,exclusionKm])),solarRelativity })
  const result = await propagateSourceOffsetEnsemble(dynamics,source,sampling.offsets,durationSeconds,signal)
  const implementationSha256 = { 'scripts/lib/scientific-file.mjs': sha(await read(new URL('scripts/lib/scientific-file.mjs', root))) }
  for (const path of ['scripts/propagate-sbdb-ensemble.mjs','src/data/loaders/sbdbCovariance.ts',
    'src/engine/ephemeris/covarianceSampling.ts','src/engine/ephemeris/covarianceStateSamples.ts','src/engine/ephemeris/orbitCovariance.ts', 'src/engine/ephemeris/conicCovariancePlane.ts',
    'src/engine/ephemeris/kepler.ts','src/engine/ephemeris/conicPeriapsis.ts','src/engine/ephemeris/spk.ts',
    'src/engine/ephemeris/spkType17.ts','src/engine/ephemeris/spkType21.ts','src/engine/dynamics/nonlinearEnsemble.ts',
    'src/engine/dynamics/ensembleMoments.ts','src/engine/dynamics/de440Dynamics.ts', 'src/engine/dynamics/de440Source.ts','src/engine/dynamics/pointMassGravity.ts',
    'src/engine/dynamics/solarRelativity.ts','src/engine/dynamics/adaptiveIntegrator.ts']) implementationSha256[path] = sha(await read(new URL(path,root)))
  const receipt = { schemaVersion: 1,calculation: 'conditional-six-parameter-de440-nonlinear-ensemble',
    sourceFile: { sha256: sha(bytes),bytes: length,originalBase64: bytes.toString('base64'),payload },implementationSha256,sampling,...result,
    packedArrayConvention: 'Row-major six-component arrays. Invalid endpoints serialize as null; consult valid and failures without dropping draw indices.' }
  const json = JSON.stringify(receipt,(_key,value) => value instanceof Float64Array || value instanceof Uint8Array ? Array.from(value) : value,2)
  signal?.throwIfAborted()
  const publication = await writeScientificReceipt(outputPath, json, { signal })
  return { ...publication,count,valid: result.valid.reduce((sum,v) => sum+v,0),evaluations: result.evaluations,moments: result.moments.status }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source,output,adoption,durationFlag,duration,exclusionFlag,exclusion,countFlag,count,seedFlag,seed,...extra] = process.argv.slice(2)
  if (!source || !output || adoption !== '--adopt-conditional-de440-model' || durationFlag !== '--duration-seconds' || exclusionFlag !== '--exclusion-km' || countFlag !== '--count' || seedFlag !== '--seed' ||
    ![duration,exclusion,count,seed].every(v => v?.trim()) || extra.length > 1 || extra.some(v => v !== '--adopt-solar-1pn')) throw new Error('Usage: node --experimental-strip-types scripts/propagate-sbdb-ensemble.mjs <sbdb.json> <new-output.json> --adopt-conditional-de440-model --duration-seconds <signed-seconds> --exclusion-km <distance> --count <1..128> --seed <uint32> [--adopt-solar-1pn]')
  const controller = new AbortController(), cancel = () => controller.abort()
  process.once('SIGINT',cancel)
  try { console.log(JSON.stringify(await propagateEnsembleFile(source,output,{ durationSeconds: Number(duration),exclusionKm: Number(exclusion),count: Number(count),seed: Number(seed),solarRelativity: extra.includes('--adopt-solar-1pn'),signal: controller.signal }),null,2)) }
  finally { process.off('SIGINT',cancel) }
}
