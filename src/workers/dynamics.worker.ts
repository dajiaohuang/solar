/// <reference lib="webworker" />
import gmText from '../data/gm_de440.tpc?raw'
import { createDe440Dynamics, DE440_FORCE_IDS } from '../engine/dynamics/de440Dynamics'
import { fetchDe440Bytes } from '../lib/fetchDe440Bytes'
import { integrateDynamicsExperiment, parseDynamicsInitial } from '../engine/dynamics/experiment'
import { parseSbdbCovariance } from '../data/loaders/sbdbCovariance'
import { propagateDynamicsCovariance } from '../engine/dynamics/covariancePropagation'
import { propagateSourceOffsetEnsemble } from '../engine/dynamics/nonlinearEnsemble'
import { searchEnsembleDistanceEvents } from '../engine/dynamics/ensembleDistanceEvents'
import { sampleSbdbCovariance } from '../engine/ephemeris/covarianceSampling'
import { dynamicsCalculation, validateDynamicsRequest, type DynamicsRequest } from './dynamics.protocol'
import { dynamicsSourceBase64 } from '../lib/dynamicsSourceBytes'

const scope = self as DedicatedWorkerGlobalScope
let started = false
scope.onmessageerror = () => {
  if (started) return
  started = true
  scope.postMessage({ type: 'error', error: 'Dynamics request could not be decoded' })
  scope.close()
}
scope.onmessage = (event: MessageEvent<DynamicsRequest>) => {
  if (started) return
  started = true
  void (async () => {
    try {
      validateDynamicsRequest(event.data)
      const calculation = dynamicsCalculation(event.data)
      const { initialBytes, durationSeconds, exclusionKm, compareRefinement, solarRelativity } = event.data
      if (initialBytes.byteLength > 2 * 1024 * 1024 || !Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365 * 86400 || !Number.isFinite(exclusionKm) || exclusionKm < 0) throw new RangeError('Invalid bounded experiment input')
      const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(initialBytes))
      const originalBase64 = dynamicsSourceBase64(initialBytes)
      const covariance = ['covariance','ensemble','ensemble-events'].includes(event.data.kind ?? '') ? parseSbdbCovariance(payload) : null
      if (covariance && covariance.labels.length !== 6) throw new RangeError('Additional source parameters require matched force derivatives; no axes will be dropped')
      if (event.data.kind === 'ensemble' && (!Number.isSafeInteger(event.data.sampleCount) || event.data.sampleCount! < 1 || event.data.sampleCount! > 128)) throw new RangeError('Ensemble requires 1 to 128 samples')
      const sampling = event.data.kind === 'ensemble' ? sampleSbdbCovariance(covariance!, event.data.sampleCount!, event.data.seed!) : null
      const input = covariance ? null : parseDynamicsInitial(payload)
      const adoptSrp = event.data.adoptSolarRadiationPressure ?? false
      if (typeof adoptSrp !== 'boolean' || Boolean(input?.solarRadiationPressure) !== adoptSrp) throw new RangeError('Solar radiation pressure requires manual initial conditions with explicit parameters and adoption; covariance adoption is unsupported')
      const inputHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', initialBytes)), v => v.toString(16).padStart(2, '0')).join('')
      const spkBytes = await fetchDe440Bytes()
      const dynamics = await createDe440Dynamics({ spkBytes, takeSpkBytesOwnership: true, gmText, referenceEpochTdb: covariance ? covariance.solutionEpochTdb : input!.referenceEpochTdb,
        elapsedRangeSeconds: [Math.min(0, durationSeconds), Math.max(0, durationSeconds)], exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, exclusionKm])), solarRelativity, solarRadiationPressure: input?.solarRadiationPressure })
      if (covariance) {
        if (event.data.kind === 'ensemble-events') {
          const result = await searchEnsembleDistanceEvents(dynamics,covariance,event.data.sampleCount!,event.data.seed!, {
            ...event.data.eventSearch!, startSeconds: Math.min(0,durationSeconds), endSeconds: Math.max(0,durationSeconds),
          })
          const arrays = [result.sampling.offsets,result.initial.offsets,result.initial.states,result.initial.valid,result.initial.additionalValues]
          const buffers = new Set<ArrayBuffer>()
          for (const array of arrays) {
            if (!(array.buffer instanceof ArrayBuffer)) throw new TypeError('Event ensemble output requires owned buffers')
            buffers.add(array.buffer)
          }
          scope.postMessage({ type: 'done', receipt: { schemaVersion: 1, calculation,
            sourceFile: { sha256: inputHash, bytes: initialBytes.byteLength, originalBase64, payload },
            finalEpoch: { referenceEpochTdb: covariance.solutionEpochTdb, elapsedTdbSeconds: durationSeconds }, ...result } }, [...buffers])
          return
        }
        if (sampling) {
          const result = await propagateSourceOffsetEnsemble(dynamics, covariance, sampling.offsets, durationSeconds)
          // These owned buffers are no longer used after the terminal message.
          // Transfer both offset records intact: receipt binding compares them.
          const buffers = new Set<ArrayBuffer>()
          for (const array of [sampling.offsets, result.initial.offsets, result.initial.states,
            result.initial.additionalValues, result.initial.valid, result.finalStates, result.valid]) {
            if (!(array.buffer instanceof ArrayBuffer)) throw new TypeError('Ensemble output requires owned ArrayBuffer storage')
            buffers.add(array.buffer)
          }
          scope.postMessage({ type: 'done', receipt: { schemaVersion: 1, calculation,
            sourceFile: { sha256: inputHash, bytes: initialBytes.byteLength, originalBase64, payload }, sampling, ...result } }, [...buffers])
          return
        }
        const result = await propagateDynamicsCovariance(dynamics, covariance, durationSeconds, undefined, compareRefinement)
        scope.postMessage({ type: 'done', receipt: { schemaVersion: 1, calculation,
          sourceFile: { sha256: inputHash, bytes: initialBytes.byteLength, originalBase64, payload }, ...result } })
        return
      }
      const result = await integrateDynamicsExperiment(dynamics, input!.initial, durationSeconds, undefined, compareRefinement)
      scope.postMessage({ type: 'done', receipt: { schemaVersion: 1, calculation,
        initialFile: { sha256: inputHash, bytes: initialBytes.byteLength, originalBase64, payload: input!.payload }, ...result } })
    } catch (error) { scope.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) }) }
    finally { scope.close() }
  })()
}
