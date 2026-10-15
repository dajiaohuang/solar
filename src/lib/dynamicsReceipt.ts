import { DE440_DYNAMICS_SOURCE } from '../engine/dynamics/de440Source.ts'
import { dynamicsCalculation, type DynamicsRequest } from '../workers/dynamics.protocol.ts'
import { checkSbdbCoordinateBinding } from './sbdbReceiptBinding.ts'
import { checkEnsembleReceipt } from './ensembleReceipt.ts'
import { SOLAR_1PN } from '../engine/dynamics/solarRelativity.ts'
import { SOLAR_RADIATION_PRESSURE } from '../engine/dynamics/solarRadiationPressure.ts'
import { parseSbdbCovariance } from '../data/loaders/sbdbCovariance.ts'
import { sampleSbdbCovariance } from '../engine/ephemeris/covarianceSampling.ts'
import { checkEnsembleEventReceipt } from './ensembleEventReceipt.ts'
import { checkCovariancePushforward } from './covariancePushforwardReceipt.ts'
import { checkIntegrationReceipt } from './integrationReceipt.ts'
import { checkEnsembleInitialReceipt } from './ensembleInitialReceipt.ts'
import { checkDe440MassReceipt } from './de440MassReceipt.ts'
import { compensatedFloat64Dot } from '../engine/numerics/compensatedMatrixProduct.ts'

const AU_KM = 149597870.7, DAY_SECONDS = 86400

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed dynamics receipt contract')
  return value as Record<string, unknown>
}

/** Replays only the producer's bounded B B^T summary, not dynamics or a Jacobian. */
function checkCovarianceCoordinates(value: unknown) {
  const coordinates = record(value)
  const vector = (value: unknown): number[] => {
    if (!Array.isArray(value) || value.length !== 6) throw new Error('Covariance coordinate vector must contain six values')
    return Array.from(value, item => {
      if (typeof item !== 'number' || !Number.isFinite(item)) throw new Error('Nonfinite covariance coordinate value')
      return item
    })
  }
  const matrix = (value: unknown): number[][] => {
    if (!Array.isArray(value) || value.length !== 6) throw new Error('Covariance coordinate matrix must contain six rows')
    return Array.from(value, vector)
  }
  vector(coordinates.nominal)
  const covariance = matrix(coordinates.matrix), root = matrix(coordinates.squareRoot), sigmas = vector(coordinates.marginalSigmas)
  for (let i = 0; i < 6; i++) {
    if (covariance[i][i] < 0 || sigmas[i] < 0 || sigmas[i] !== Math.sqrt(covariance[i][i])) throw new Error('Covariance standard deviation differs from its variance')
    for (let j = 0; j < 6; j++) {
      // Replay the producer's declared compensated covariance arithmetic.
      const expected = compensatedFloat64Dot(root[i], root[j])
      if (!Number.isFinite(expected) || covariance[i][j] !== covariance[j][i] || covariance[i][j] !== expected) {
        throw new Error('Covariance matrix differs from its square-root factor')
      }
    }
  }
}

/** Request binding only. This does not establish numerical/physical accuracy. */
export async function checkDynamicsReceipt(value: unknown, request: DynamicsRequest, inputHash: string, inputBytes: number, inputPayload: unknown, originalBase64: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const receipt = record(value)
  if (receipt.schemaVersion !== 1 || receipt.calculation !== dynamicsCalculation(request)) throw new Error('Dynamics calculation does not match the requested experiment')
  const source = record(request.kind ? receipt.sourceFile : receipt.initialFile)
  if (source.sha256 !== inputHash || source.bytes !== inputBytes) throw new Error('Dynamics result source does not match the input file')
  if (source.originalBase64 !== originalBase64) throw new Error('Dynamics receipt original bytes differ from submitted input')
  const submitted = record(inputPayload)
  if (JSON.stringify(source.payload) !== JSON.stringify(submitted)) throw new Error('Dynamics receipt payload differs from submitted input')
  const sourceEpoch = request.kind ? record(record(submitted.orbit).covariance).epoch : submitted.referenceEpochTdb
  if ((typeof sourceEpoch !== 'number' && typeof sourceEpoch !== 'string') ||
      typeof sourceEpoch === 'string' && !sourceEpoch.trim() || !Number.isFinite(Number(sourceEpoch))) throw new Error('Invalid submitted dynamics reference epoch')
  const experiment = request.kind === 'covariance' ? record(receipt.experiment) : receipt
  const epoch = record(experiment.finalEpoch), force = record(experiment.forceModel)
  if (epoch.elapsedTdbSeconds !== request.durationSeconds || epoch.referenceEpochTdb !== Number(sourceEpoch) || epoch.referenceEpochTdb !== force.referenceEpochTdb ||
      typeof epoch.referenceEpochTdb !== 'number' || !Number.isFinite(epoch.referenceEpochTdb)) throw new Error('Dynamics result epoch does not match the experiment')
  const window = force.elapsedRangeSeconds
  if (!Array.isArray(window) || window.length !== 2 || window[0] !== Math.min(0, request.durationSeconds) ||
      window[1] !== Math.max(0, request.durationSeconds)) throw new Error('Dynamics frozen window differs from the requested integration interval')
  const kernel = record(force.kernel)
  for (const key of Object.keys(DE440_DYNAMICS_SOURCE) as (keyof typeof DE440_DYNAMICS_SOURCE)[]) {
    if (kernel[key] !== DE440_DYNAMICS_SOURCE[key]) throw new Error('Dynamics kernel evidence differs from the pinned source')
  }
  const referenceEt = (Number(sourceEpoch)-2451545)*86400
  if (referenceEt+window[0] < DE440_DYNAMICS_SOURCE.startEt || referenceEt+window[1] > DE440_DYNAMICS_SOURCE.endEt) throw new Error('Dynamics interval exceeds pinned source coverage')
  if (force.frame !== 'J2000' || force.origin !== 'SSB' || force.timeScale !== 'TDB' || force.aberration !== 'NONE') throw new Error('Dynamics force coordinates do not match the contract')
  if (JSON.stringify(force.stateUnits) !== JSON.stringify(['km','km','km','km/s','km/s','km/s']) ||
      force.ephemerisSource !== `${DE440_DYNAMICS_SOURCE.id} SHA-256 ${DE440_DYNAMICS_SOURCE.sha256}`) throw new Error('Dynamics force units or ephemeris identity mismatch')
  if (!Array.isArray(force.limitations) || !force.limitations.length || force.limitations.length > 128 ||
      force.limitations.some(note => typeof note !== 'string' || !note.trim())) throw new Error('Dynamics force limitations missing')
  const model = request.adoptSolarRadiationPressure
    ? (request.solarRelativity ? 'restricted-newtonian-plus-solar-1pn-and-radial-srp' : 'restricted-newtonian-plus-radial-srp')
    : (request.solarRelativity ? 'restricted-newtonian-plus-solar-1pn' : 'restricted-newtonian-prescribed-point-masses')
  if (force.model !== model) throw new Error('Dynamics force model identifier mismatch')
  if (request.solarRelativity ? record(force.solarRelativity).model !== 'solar-monopole-1pn' : force.solarRelativity !== null) throw new Error('Dynamics relativity adoption mismatch')
  if (request.solarRelativity) {
    const relativity = record(force.solarRelativity)
    if (Object.entries(SOLAR_1PN).some(([key, value]) => relativity[key] !== value)) throw new Error('Dynamics relativity parameters or reference mismatch')
  }
  if (request.adoptSolarRadiationPressure ? record(record(force.solarRadiationPressure).parameters).model !== 'constant-radial-srp' : force.solarRadiationPressure !== null) throw new Error('Dynamics radiation pressure adoption mismatch')
  if (request.adoptSolarRadiationPressure) {
    const radiation = record(force.solarRadiationPressure)
    if (Object.entries(SOLAR_RADIATION_PRESSURE).some(([key, value]) => radiation[key] !== value)) throw new Error('Dynamics radiation pressure formulation or reference mismatch')
    const expected = record(submitted.solarRadiationPressure), actual = record(record(force.solarRadiationPressure).parameters)
    const keys = Object.keys(expected)
    if (Object.keys(actual).length !== keys.length || keys.some(key => actual[key] !== expected[key])) throw new Error('Dynamics radiation pressure parameters differ from submitted input')
  }
  const forceMasses = force.masses
  await checkDe440MassReceipt(forceMasses,request.exclusionKm)
  if (request.kind === 'ensemble-events') {
    checkSbdbCoordinateBinding(submitted,receipt,'ensemble')
    await checkEnsembleEventReceipt(receipt,request,submitted,signal)
    return
  }
  if (request.durationSeconds === 0 && request.kind !== 'ensemble') {
    const identity = Array.from({ length: 36 }, (_, i) => Math.floor(i/6) === i%6 ? 1 : 0)
    const transition = record(experiment.transitionMatrix)
    if (transition.dimension !== 6 || JSON.stringify(transition.values) !== JSON.stringify(identity)) throw new Error('Zero-duration transition must be identity')
    const checkZeroWork = (raw: unknown) => {
      const numerics = record(raw)
      for (const key of ['accepted','rejected','attempts','evaluations','largestAcceptedStep','maxAcceptedErrorRatio']) {
        if (numerics[key] !== 0) throw new Error('Zero-duration integration reports numerical work')
      }
      if (numerics.smallestAcceptedStep !== null) throw new Error('Zero-duration integration has an accepted step')
    }
    checkZeroWork(experiment.numerics)
    if (record(experiment.numerics).elapsed !== 0) throw new Error('Zero-duration integration elapsed time mismatch')
    if (!request.kind && JSON.stringify(experiment.finalStateKmKmPerSecond) !== JSON.stringify(submitted.initial)) throw new Error('Zero-duration state differs from the submitted initial state')
    if (request.compareRefinement) {
      const refined = record(experiment.refinement)
      checkZeroWork(refined)
      if (JSON.stringify(refined.transitionMatrixValues) !== JSON.stringify(identity) ||
          JSON.stringify(refined.finalStateKmKmPerSecond) !== JSON.stringify(experiment.finalStateKmKmPerSecond) ||
          refined.endpointPositionDifferenceKm !== 0 || refined.endpointVelocityDifferenceKmPerSecond !== 0 || refined.maxNormalizedTransitionDifference !== 0) {
        throw new Error('Zero-duration refinement differs from the identity experiment')
      }
    }
  }
  if (request.kind !== 'ensemble' && (request.compareRefinement ? !experiment.refinement : experiment.refinement !== null)) throw new Error('Dynamics refinement adoption mismatch')
  if (request.kind !== 'ensemble') await checkIntegrationReceipt(experiment, request.durationSeconds, request.kind ? undefined : submitted.initial)
  if (request.kind !== 'ensemble' && request.compareRefinement) {
    const refinement = record(experiment.refinement), tolerances = refinement.absoluteTolerance
    if (refinement.relativeTolerance !== 1e-13 || refinement.initialStep !== 1800 || refinement.maxStep !== 43200 || refinement.maxAttempts !== 20000 ||
        !Array.isArray(tolerances) || tolerances.length !== 42 || tolerances.some((value, i) => value !== (i < 3 ? 1e-5 : 1e-12)/10)) throw new Error('Dynamics refinement numerical settings mismatch')
  }
  if (request.kind === 'ensemble') {
    const sampling = record(receipt.sampling)
    if (sampling.count !== request.sampleCount || sampling.seed !== request.seed || record(receipt.initial).count !== request.sampleCount) throw new Error('Dynamics ensemble sampling settings mismatch')
    checkEnsembleReceipt(receipt, request.sampleCount!, request.durationSeconds)
    // Both returned offset arrays could agree with one another but originate
    // from another seed or covariance. Reconstruct this bounded same-runtime
    // stream from the submitted source, not the worker's claimed source object.
    const source = parseSbdbCovariance(submitted)
    const expected = sampleSbdbCovariance(source, request.sampleCount!, request.seed!)
    for (const key of ['algorithm','distribution','count','dimension','seed','labels','units','nominal','solutionEpochTdb','solutionId','factorization'] as const) {
      if (JSON.stringify(sampling[key]) !== JSON.stringify(expected[key])) {
        throw new Error(`Dynamics ensemble sampling ${key} differs from the submitted source and request`)
      }
    }
    const offsets = sampling.offsets
    if (!(offsets instanceof Float64Array) || offsets.length !== expected.offsets.length ||
        offsets.some((offset, index) => offset !== expected.offsets[index])) {
      throw new Error('Dynamics ensemble offsets differ from the requested source covariance and seed')
    }
    const solar = (forceMasses as unknown[]).map(record).find(mass => mass.naifId === 10)!
    await checkEnsembleInitialReceipt(source, receipt.initial, expected.offsets, {
      au3PerDay2: (solar.gmKm3PerSecond2 as number)*DAY_SECONDS**2/AU_KM**3,
      source: solar.gmSource as string,
    }, signal)
  }
  if (request.kind === 'covariance') {
    checkCovariancePushforward(submitted, receipt)
    checkCovarianceCoordinates(receipt.finalCoordinates)
    const finalEpoch = record(record(receipt.finalCoordinates).epoch)
    if (finalEpoch.referenceEpochTdb !== epoch.referenceEpochTdb || finalEpoch.elapsedTdbSeconds !== epoch.elapsedTdbSeconds) throw new Error('Covariance coordinate epoch differs from the integration epoch')
    if (request.compareRefinement) {
      checkCovarianceCoordinates(receipt.covarianceRefinement)
      const comparison = record(receipt.covarianceRefinement), refinedEpoch = record(comparison.epoch)
      if (refinedEpoch.referenceEpochTdb !== epoch.referenceEpochTdb || refinedEpoch.elapsedTdbSeconds !== epoch.elapsedTdbSeconds) throw new Error('Refined covariance epoch mismatch')
      const primary = record(receipt.finalCoordinates)
      if (comparison.frame !== primary.frame || JSON.stringify(comparison.labels) !== JSON.stringify(primary.labels) || JSON.stringify(comparison.units) !== JSON.stringify(primary.units)) throw new Error('Refined covariance coordinates mismatch')
      const deviations = comparison.marginalSigmas, differences = comparison.marginalSigmaAbsoluteDifference, original = primary.marginalSigmas
      if (!Array.isArray(deviations) || deviations.length !== 6 || !Array.isArray(differences) || differences.length !== 6 || !Array.isArray(original) || original.length !== 6 ||
          deviations.some((value, i) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || typeof original[i] !== 'number' || !Number.isFinite(original[i]) || original[i] < 0 || differences[i] !== Math.abs(value-original[i]))) throw new Error('Refined covariance sigma comparison mismatch')
    } else if (receipt.covarianceRefinement !== null) throw new Error('Unrequested covariance refinement')
  }
  if (request.kind) checkSbdbCoordinateBinding(submitted, receipt, request.kind)
}
