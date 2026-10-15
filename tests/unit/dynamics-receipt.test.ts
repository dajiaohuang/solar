import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../../src/engine/dynamics/de440Dynamics'
import { integrateDynamicsExperiment } from '../../src/engine/dynamics/experiment'
import { parseSbdbCovariance } from '../../src/data/loaders/sbdbCovariance'
import { propagateSourceOffsetEnsemble } from '../../src/engine/dynamics/nonlinearEnsemble'
import { searchEnsembleDistanceEvents } from '../../src/engine/dynamics/ensembleDistanceEvents'
import { summarizeEnsembleEndpoints } from '../../src/engine/dynamics/ensembleMoments'
import { sampleSbdbCovariance } from '../../src/engine/ephemeris/covarianceSampling'
import { dynamicsCalculation, type DynamicsRequest } from '../../src/workers/dynamics.protocol'
import { dynamicsSourceBase64 } from '../../src/lib/dynamicsSourceBytes'
import { checkDynamicsReceipt } from '../../src/lib/dynamicsReceipt'
import { propagateDynamicsCovariance } from '../../src/engine/dynamics/covariancePropagation'
import eros from '../fixtures/sbdb-eros-covariance.json'

const spk = readFileSync(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`)
const gmText = readFileSync('src/data/gm_de440.tpc','utf8')

test('accepts compensated covariance receipts and rejects a changed matrix', async () => {
  const raw = Buffer.from(JSON.stringify(eros)), initialBytes = raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)
  const payload = JSON.parse(raw.toString('utf8')), source = parseSbdbCovariance(payload)
  const request: DynamicsRequest = { kind: 'covariance', initialBytes, durationSeconds: 86400,
    exclusionKm: 0, compareRefinement: false, solarRelativity: true }
  const dynamics = await createDe440Dynamics({ spkBytes: spk.buffer.slice(spk.byteOffset,spk.byteOffset+spk.byteLength), gmText,
    referenceEpochTdb: source.solutionEpochTdb, elapsedRangeSeconds: [0,86400],
    exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id,0])), solarRelativity: true })
  const result = await propagateDynamicsCovariance(dynamics,source,request.durationSeconds)
  const originalBase64 = dynamicsSourceBase64(initialBytes), hash = createHash('sha256').update(raw).digest('hex')
  const receipt = { schemaVersion: 1, calculation: dynamicsCalculation(request),
    sourceFile: { sha256: hash, bytes: raw.byteLength, originalBase64, payload }, ...result }
  const verify = (value: unknown) => checkDynamicsReceipt(value,request,hash,raw.byteLength,payload,originalBase64)
  await expect(verify(receipt)).resolves.toBeUndefined()
  const changed = structuredClone(receipt)
  changed.finalCoordinates.matrix[0][1] *= 1.01
  changed.finalCoordinates.matrix[1][0] = changed.finalCoordinates.matrix[0][1]
  await expect(verify(changed)).rejects.toThrow('Covariance matrix differs from its square-root factor')
})

test('accepts a producer ensemble receipt and rejects source-inconsistent initial states', async () => {
  const raw = Buffer.from(JSON.stringify(eros)), initialBytes = raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)
  const payload = JSON.parse(raw.toString('utf8')), source = parseSbdbCovariance(payload)
  const request: DynamicsRequest = { kind:'ensemble',initialBytes,durationSeconds:0,exclusionKm:0,
    compareRefinement:false,solarRelativity:false,sampleCount:2,seed:42 }
  const sampling = sampleSbdbCovariance(source,request.sampleCount!,request.seed!)
  const dynamics = await createDe440Dynamics({ spkBytes:spk.buffer.slice(spk.byteOffset,spk.byteOffset+spk.byteLength),gmText,
    referenceEpochTdb:source.solutionEpochTdb,elapsedRangeSeconds:[0,0],exclusionKm:Object.fromEntries(DE440_FORCE_IDS.map(id=>[id,0])) })
  const result = await propagateSourceOffsetEnsemble(dynamics,source,sampling.offsets,0)
  const originalBase64 = dynamicsSourceBase64(initialBytes)
  const receipt = { schemaVersion:1,calculation:dynamicsCalculation(request),
    sourceFile:{sha256:createHash('sha256').update(raw).digest('hex'),bytes:raw.byteLength,originalBase64,payload},sampling,...result }
  const verify = (value: typeof receipt) => checkDynamicsReceipt(value,request,receipt.sourceFile.sha256,raw.byteLength,payload,originalBase64)
  await expect(verify(receipt)).resolves.toBeUndefined()

  const changed = structuredClone(receipt)
  changed.initial.states[0] += 1e-9
  changed.finalStates[0] += 1e-9
  changed.moments = summarizeEnsembleEndpoints(changed.finalStates,changed.valid)
  await expect(verify(changed)).rejects.toThrow('initial states')
})

test('event-ensemble receipt binds initial samples to the source before event claims', async () => {
  const raw = Buffer.from(JSON.stringify(eros)), initialBytes = raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)
  const payload = JSON.parse(raw.toString('utf8')), source = parseSbdbCovariance(payload)
  const settings = { targetNaifId:399,distanceKm:1,maxStepSeconds:86400,toleranceSeconds:1,maxEvaluations:4,maxEvents:2 }
  const request: DynamicsRequest = { kind:'ensemble-events',initialBytes,durationSeconds:0,exclusionKm:0,
    compareRefinement:false,solarRelativity:false,sampleCount:2,seed:42,eventSearch:settings }
  const dynamics = await createDe440Dynamics({ spkBytes:spk.buffer.slice(spk.byteOffset,spk.byteOffset+spk.byteLength),gmText,
    referenceEpochTdb:source.solutionEpochTdb,elapsedRangeSeconds:[0,0],exclusionKm:Object.fromEntries(DE440_FORCE_IDS.map(id=>[id,0])) })
  const result = await searchEnsembleDistanceEvents(dynamics,source,2,42,{...settings,startSeconds:0,endSeconds:0})
  const originalBase64 = dynamicsSourceBase64(initialBytes), sha256 = createHash('sha256').update(raw).digest('hex')
  const receipt = { schemaVersion:1,calculation:dynamicsCalculation(request),sourceFile:{sha256,bytes:raw.byteLength,originalBase64,payload},
    finalEpoch:{referenceEpochTdb:source.solutionEpochTdb,elapsedTdbSeconds:0},...result }
  const verify = (value: typeof receipt) => checkDynamicsReceipt(value,request,sha256,raw.byteLength,payload,originalBase64)
  await expect(verify(receipt)).resolves.toBeUndefined()

  const changed = structuredClone(receipt)
  changed.initial.states[0] += 1e-9
  await expect(verify(changed)).rejects.toThrow('initial states')
})

test('direct integration receipt binds requested initial state and transition matrix integrity with or without refinement', async () => {
  const payload = { schemaVersion:1,frame:'J2000',origin:'SSB',timeScale:'TDB',referenceEpochTdb:2459000.5,
    initial:[180000000,80000000,25000000,-18,23,6],initialSource:'Direct receipt focused fixture' }
  const raw = Buffer.from(JSON.stringify(payload)), initialBytes = raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)
  const request: DynamicsRequest = { initialBytes,durationSeconds:86400,exclusionKm:0,compareRefinement:true,solarRelativity:false }
  const dynamics = await createDe440Dynamics({ spkBytes:spk.buffer.slice(spk.byteOffset,spk.byteOffset+spk.byteLength),gmText,
    referenceEpochTdb:payload.referenceEpochTdb,elapsedRangeSeconds:[0,86400],exclusionKm:Object.fromEntries(DE440_FORCE_IDS.map(id=>[id,0])) })
  const result = await integrateDynamicsExperiment(dynamics,payload.initial,request.durationSeconds,undefined,true)
  const originalBase64 = dynamicsSourceBase64(initialBytes), sha256 = createHash('sha256').update(raw).digest('hex')
  const receipt = { schemaVersion:1,calculation:dynamicsCalculation(request),initialFile:{sha256,bytes:raw.byteLength,originalBase64,payload},...result }
  const verify = (value: typeof receipt) => checkDynamicsReceipt(value,request,sha256,raw.byteLength,payload,originalBase64)
  await expect(verify(receipt)).resolves.toBeUndefined()

  // Exercise the producer's actual no-refinement path, which previously
  // returned a transition matrix that the main-thread receipt checker trusted.
  const noRefinementRequest = { ...request, compareRefinement:false }
  const noRefinementResult = await integrateDynamicsExperiment(dynamics,payload.initial,request.durationSeconds,undefined,false)
  const noRefinementReceipt = { schemaVersion:1,calculation:dynamicsCalculation(noRefinementRequest),
    initialFile:{sha256,bytes:raw.byteLength,originalBase64,payload},...noRefinementResult }
  await expect(checkDynamicsReceipt(noRefinementReceipt,noRefinementRequest,sha256,raw.byteLength,payload,originalBase64)).resolves.toBeUndefined()
  const changedWithoutRefinement = structuredClone(noRefinementReceipt)
  changedWithoutRefinement.transitionMatrix.values[0] += 1
  await expect(checkDynamicsReceipt(changedWithoutRefinement,noRefinementRequest,sha256,raw.byteLength,payload,originalBase64))
    .rejects.toThrow('Transition matrix receipt integrity mismatch')

  const changed = structuredClone(receipt)
  changed.transitionMatrix.values[0] += 1
  await expect(verify(changed)).rejects.toThrow('Transition matrix receipt integrity mismatch')
  const changedRefinement = structuredClone(receipt)
  changedRefinement.refinement!.transitionMatrixValues[0] += 1
  await expect(verify(changedRefinement)).rejects.toThrow('Transition matrix receipt integrity mismatch')
})
