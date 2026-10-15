import { summarizeEnsembleEndpoints } from '../engine/dynamics/ensembleMoments.ts'

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ensemble record required')
  return value as Record<string, unknown>
}
const requireReceipt = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
const integer = (value: unknown, maximum: number): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error('Bounded ensemble integer required')
  return value
}
const vector = (value: unknown, count: number): number[] => {
  if (!Array.isArray(value) || value.length !== count) throw new Error('Finite ensemble vector required')
  // Array.prototype.some/every skip holes; materialize every required axis.
  return Array.from(value, entry => {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) throw new Error('Finite ensemble vector required')
    return entry
  })
}

/** Live worker receipt consistency, not re-integration or source authentication.
 * Typed NaN sentinels are checked before JSON exports turn them into null. */
export function checkEnsembleReceipt(receipt: Record<string, unknown>, count: number, duration: number) {
  integer(count,128);requireReceipt(count > 0,'Ensemble count required')
  const initial = object(receipt.initial), sampling = object(receipt.sampling)
  requireReceipt(receipt.method === 'nonlinear-joint-source-offsets-restricted-dynamics-v1' &&
    initial.method === 'nonlinear-source-offsets-to-periapsis-conic-state-v1' &&
    sampling.algorithm === 'mulberry32-box-muller-compensated-cholesky-correlation-v3' &&
    sampling.distribution === 'joint-gaussian-in-source-parameter-offsets','Ensemble method or sampling distribution mismatch')
  requireReceipt(receipt.frame === 'heliocentric-IAU76/80-ecliptic-J2000' && receipt.frame === initial.frame &&
    JSON.stringify(receipt.units) === JSON.stringify(['au','au','au','au/d','au/d','au/d']), 'Ensemble endpoint units/frame mismatch')
  const settings = object(receipt.integrationSettings)
  requireReceipt(settings.algorithm === 'dormand-prince-54-component-max-v1' && settings.relativeTolerance === 1e-12 &&
    settings.initialStep === 3600 && settings.maxStep === 86400 && settings.maxAttempts === 20000 &&
    vector(settings.absoluteTolerance,6).every((value,index) => value === (index < 3 ? 1e-5 : 1e-12)), 'Ensemble integration settings mismatch')
  for (const entry of [receipt,initial,sampling]) {
    const notes = entry.limitations
    requireReceipt(Array.isArray(notes) && notes.length > 0 && notes.every(note => typeof note === 'string' && note.trim().length > 0),'Ensemble limitations missing')
  }
  requireReceipt(initial.additionalValues instanceof Float64Array && initial.additionalValues.length === 0 &&
    Array.isArray(initial.additionalLabels) && initial.additionalLabels.length === 0 &&
    Array.isArray(initial.additionalUnits) && initial.additionalUnits.length === 0,'Unexpected extra ensemble axes')
  const states = receipt.finalStates, valid = receipt.valid, initialStates = initial.states, initialValid = initial.valid
  if (!(states instanceof Float64Array) || states.length !== count*6 || !(initialStates instanceof Float64Array) || initialStates.length !== count*6 ||
      !(valid instanceof Uint8Array) || valid.length !== count || !(initialValid instanceof Uint8Array) || initialValid.length !== count) throw new Error('Ensemble packed array shape mismatch')
  const offsets = initial.offsets, sampled = sampling.offsets
  if (!(offsets instanceof Float64Array) || offsets.length !== count*6 || !(sampled instanceof Float64Array) || sampled.length !== offsets.length ||
      offsets.some((value,index) => !Number.isFinite(value) || value !== sampled[index])) throw new Error('Ensemble source offsets mismatch')
  const counts = vector(receipt.forceEvaluationsByDraw,count)
  counts.forEach(value => integer(value,250000))
  requireReceipt(receipt.maxEvaluations === 250000 && counts.reduce((sum,value) => sum+value,0) === integer(receipt.evaluations,250000),'Ensemble force totals mismatch')
  const failures = new Map<number,Record<string,unknown>>(), initialFailures = new Map<number,Record<string,unknown>>()
  for (const [raw,target] of [[receipt.failures,failures],[initial.failures,initialFailures]] as const) {
    if (!Array.isArray(raw) || raw.length > count) throw new Error('Bounded ensemble failure array required')
    for (const entry of raw) {
      const failure = object(entry), index = integer(failure.index,count-1)
      requireReceipt(!target.has(index) && typeof failure.reason === 'string' && failure.reason.length > 0,'Duplicate or missing ensemble failure')
      target.set(index,failure)
    }
  }
  if (!Array.isArray(receipt.numerics) || receipt.numerics.length > count) throw new Error('Bounded ensemble diagnostics required')
  const numerics = new Map<number,Record<string,unknown>>()
  for (const entry of receipt.numerics) {
    const diagnostic = object(entry), index = integer(diagnostic.index,count-1)
    requireReceipt(!numerics.has(index),'Duplicate ensemble diagnostics')
    const accepted = integer(diagnostic.accepted,20000), rejected = integer(diagnostic.rejected,20000)
    requireReceipt(accepted+rejected <= 20000 && diagnostic.evaluations === counts[index] &&
      (duration === 0 ? accepted === 0 && rejected === 0 && counts[index] === 0 : accepted > 0 && counts[index] === 1+6*(accepted+rejected)), 'Ensemble diagnostics mismatch')
    numerics.set(index,diagnostic)
  }
  let failedCount = 0
  for (let index=0;index<count;index++) {
    requireReceipt(valid[index] <= 1 && initialValid[index] <= 1,'Invalid ensemble validity flag')
    const failure = failures.get(index), firstFailure = initialFailures.get(index)
    requireReceipt(Boolean(failure) === !valid[index] && Boolean(firstFailure) === !initialValid[index],'Ensemble failure identity mismatch')
    for (let axis=0;axis<6;axis++) {
      const position = index*6+axis
      requireReceipt(initialValid[index] ? Number.isFinite(initialStates[position]) : Number.isNaN(initialStates[position]),'Initial ensemble state sentinel mismatch')
      requireReceipt(valid[index] ? Number.isFinite(states[position]) : Number.isNaN(states[position]),'Final ensemble state sentinel mismatch')
      if (duration === 0 && initialValid[index]) requireReceipt(valid[index] === 1 && states[position] === initialStates[position],'Zero-duration ensemble identity mismatch')
    }
    if (!initialValid[index]) requireReceipt(valid[index] === 0 && counts[index] === 0 && !numerics.has(index) && failure?.stage === 'coordinates' && failure.reason === firstFailure?.reason,'Failed initial draw replaced')
    else if (valid[index]) requireReceipt(numerics.has(index),'Completed ensemble diagnostics missing')
    else requireReceipt(duration !== 0 && (failure?.stage === 'integration' && !numerics.has(index) || failure?.stage === 'projection' && numerics.has(index)),'Ensemble failure stage mismatch')
    if (!valid[index]) failedCount++
  }
  const moments = object(receipt.moments)
  requireReceipt(moments.count === count && moments.failedCount === failedCount,'Ensemble moment counts mismatch')
  if (failedCount || count < 2) {
    requireReceipt(moments.status === 'unavailable' && moments.reason === (failedCount ? 'failed-draws' : 'insufficient-draws'),'Unavailable ensemble moments mismatch')
    for (const key of ['anchor','meanOffset','mean','covariance','standardDeviations']) requireReceipt(moments[key] == null,'Unavailable ensemble moments contain values')
  } else {
    requireReceipt(moments.status === 'available' && moments.reason == null && moments.covarianceDivisor === count-1 && moments.method === 'anchored-compensated-two-pass-sample-moments-v1','Available ensemble moments mismatch')
    const anchor = vector(moments.anchor,6), offset = vector(moments.meanOffset,6), mean = vector(moments.mean,6), sigma = vector(moments.standardDeviations,6)
    if (!Array.isArray(moments.covariance) || moments.covariance.length !== 6) throw new Error('Ensemble covariance shape mismatch')
    const covariance = moments.covariance.map(row => vector(row,6))
    // Bind moments to the actual returned endpoints, not merely to another
    // internally consistent mean/covariance. This is bounded (128 by 6) and
    // repeats the declared summary method, not force integration or calibration.
    const expected = summarizeEnsembleEndpoints(states, valid)
    if (expected.status !== 'available') throw new Error('Available ensemble moments lack valid endpoint support')
    for (let i=0;i<6;i++) {
      requireReceipt(anchor[i] === states[i] && mean[i] === anchor[i]+offset[i] && covariance[i][i] >= 0 && sigma[i] === Math.sqrt(covariance[i][i]),'Ensemble moment consistency mismatch')
      requireReceipt(offset[i] === expected.meanOffset[i] && mean[i] === expected.mean[i] && sigma[i] === expected.standardDeviations[i], 'Ensemble moments do not match endpoint samples')
      for (let j=0;j<6;j++) requireReceipt(covariance[i][j] === covariance[j][i] && covariance[i][j] === expected.covariance[i][j],'Ensemble covariance does not match endpoint samples')
    }
  }
}
