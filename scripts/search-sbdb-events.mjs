// Offline event ensemble. Explicit model adoption; no retrieval or deployment.
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readScientificFile, writeScientificReceipt } from './lib/scientific-file.mjs'
import { parseSbdbCovariance } from '../src/data/loaders/sbdbCovariance.ts'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../src/engine/dynamics/de440Dynamics.ts'
import { searchEnsembleDistanceEvents } from '../src/engine/dynamics/ensembleDistanceEvents.ts'
import { validateDynamicsRequest, dynamicsCalculation } from '../src/workers/dynamics.protocol.ts'
import { checkDynamicsReceipt } from '../src/lib/dynamicsReceipt.ts'

const root = new URL('../',import.meta.url)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

export async function searchEnsembleEventsFile(sourcePath, settingsPath, outputPath, { signal } = {}) {
  signal?.throwIfAborted()
  const read = (path,maximum = 2*1024*1024) => readScientificFile(path,maximum,{signal})
  const settingsBytes = await read(settingsPath,64*1024)
  const settings = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(settingsBytes))
  const allowed = ['durationSeconds','exclusionKm','sampleCount','seed','solarRelativity','eventSearch']
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      Object.keys(settings).some(key => !allowed.includes(key))) throw new RangeError('Invalid event-ensemble settings object')
  const bytes = await read(sourcePath)
  const initialBytes = bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)
  const request = { ...settings,kind:'ensemble-events',initialBytes,compareRefinement:false }
  validateDynamicsRequest(request)
  const payload = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
  const source = parseSbdbCovariance(payload)
  if (source.labels.length !== 6 || source.additionalParameters.length) throw new RangeError('Additional source axes require matched forces; none may be dropped')
  const kernel = await readScientificFile(new URL(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`,root),DE440_DYNAMICS_SOURCE.bytes,
    {signal,exactBytes:DE440_DYNAMICS_SOURCE.bytes})
  const gm = await read(new URL('src/data/gm_de440.tpc',root),1024*1024)
  signal?.throwIfAborted()
  const dynamics = await createDe440Dynamics({spkBytes:kernel.buffer.slice(kernel.byteOffset,kernel.byteOffset+kernel.byteLength),
    gmText:new TextDecoder('utf-8',{fatal:true}).decode(gm),referenceEpochTdb:source.solutionEpochTdb,
    elapsedRangeSeconds:[Math.min(0,request.durationSeconds),Math.max(0,request.durationSeconds)],
    exclusionKm:Object.fromEntries(DE440_FORCE_IDS.map(id => [id,request.exclusionKm])),solarRelativity:request.solarRelativity})
  const result = await searchEnsembleDistanceEvents(dynamics,source,request.sampleCount,request.seed,{
    ...request.eventSearch,startSeconds:Math.min(0,request.durationSeconds),endSeconds:Math.max(0,request.durationSeconds),
  },signal)
  const inputHash = sha(bytes), originalBase64 = bytes.toString('base64')
  const receipt = {schemaVersion:1,calculation:dynamicsCalculation(request),
    sourceFile:{sha256:inputHash,bytes:bytes.length,originalBase64,payload},
    finalEpoch:{referenceEpochTdb:source.solutionEpochTdb,elapsedTdbSeconds:request.durationSeconds},...result}
  // Same live typed-array receipt checks as the browser; not a second integration.
  checkDynamicsReceipt(receipt,request,inputHash,bytes.length,payload,originalBase64)
  signal?.throwIfAborted()
  const implementationSha256 = {}
  for (const path of ['scripts/search-sbdb-events.mjs','scripts/lib/scientific-file.mjs',
    'src/workers/dynamics.protocol.ts','src/lib/dynamicsReceipt.ts','src/lib/ensembleEventReceipt.ts','src/lib/ensembleReceipt.ts','src/lib/sbdbReceiptBinding.ts',
    'src/data/loaders/sbdbCovariance.ts','src/engine/ephemeris/covarianceSampling.ts','src/engine/ephemeris/covarianceStateSamples.ts',
    'src/engine/ephemeris/orbitCovariance.ts','src/engine/ephemeris/conicCovariancePlane.ts','src/engine/ephemeris/conicPeriapsis.ts','src/engine/ephemeris/kepler.ts',
    'src/engine/events/trajectoryEvents.ts','src/engine/dynamics/distanceEvents.ts','src/engine/dynamics/ensembleDistanceEvents.ts','src/engine/dynamics/eventTimingSummary.ts',
    'src/engine/dynamics/de440Dynamics.ts','src/engine/dynamics/de440Source.ts','src/engine/dynamics/pointMassGravity.ts',
    'src/engine/dynamics/adaptiveIntegrator.ts','src/engine/dynamics/sampleFailure.ts','src/engine/dynamics/solarRelativity.ts','src/engine/dynamics/solarRadiationPressure.ts',
    'src/engine/ephemeris/spk.ts','src/engine/ephemeris/spkType17.ts','src/engine/ephemeris/spkType21.ts']) {
    implementationSha256[path] = sha(await read(new URL(path,root)))
  }
  const json = JSON.stringify({...receipt,implementationSha256,
    settingsFile:{sha256:sha(settingsBytes),bytes:settingsBytes.length,originalBase64:settingsBytes.toString('base64'),payload:settings},
    packedArrayConvention:'Initial states and offsets are row-major six-component arrays. Invalid coordinates encode as null. Preserve draw indices and statuses; failed and unresolved draws are not event-free.'},
  (_key,value) => value instanceof Float64Array || value instanceof Uint8Array ? Array.from(value) : value,2)
  signal?.throwIfAborted()
  const publication = await writeScientificReceipt(outputPath,json,{signal})
  return {...publication,...result.counts,forceEvaluations:result.forceEvaluations}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source,settings,output,adoption,...extra] = process.argv.slice(2)
  if (!source || !settings || !output || adoption !== '--adopt-conditional-de440-model' || extra.length) {
    throw new Error('Usage: node --experimental-strip-types scripts/search-sbdb-events.mjs <sbdb.json> <settings.json> <new-output.json> --adopt-conditional-de440-model')
  }
  const controller = new AbortController(), cancel = () => controller.abort()
  process.once('SIGINT',cancel)
  try { console.log(JSON.stringify(await searchEnsembleEventsFile(source,settings,output,{signal:controller.signal}),null,2)) }
  finally { process.off('SIGINT',cancel) }
}
