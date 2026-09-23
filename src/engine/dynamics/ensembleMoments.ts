/** Descriptive finite-ensemble moments only. Anchor before summation so a small
 * displacement is never recovered by subtracting a rounded absolute mean. */
export function summarizeEnsembleEndpoints(states: Float64Array, valid: Uint8Array) {
  const count = valid.length
  if (count < 1 || count > 128 || states.length !== 6*count || valid.some(v => v !== 0 && v !== 1)) throw new RangeError('Expected 1 to 128 indexed six-component endpoints')
  for (let i = 0; i < count; i++) if (valid[i] && !states.subarray(6*i,6*i+6).every(Number.isFinite)) throw new RangeError('Valid ensemble endpoints must be finite')
  if (valid.some(v => !v)) return { status: 'unavailable' as const, reason: 'failed-draws' as const, count }
  if (count < 2) return { status: 'unavailable' as const, reason: 'insufficient-draws' as const, count }
  const anchor = Array.from(states.subarray(0,6))
  const sum = (term: (index: number) => number) => {
    let total = 0, compensation = 0
    for (let i = 0; i < count; i++) {
      const value = term(i)-compensation, next = total+value
      compensation = (next-total)-value; total = next
    }
    return total
  }
  const meanOffset = anchor.map((origin,axis) => sum(index => states[index*6+axis]-origin)/count)
  const covariance = Array.from({ length: 6 }, () => Array<number>(6).fill(0))
  for (let row = 0; row < 6; row++) for (let column = row; column < 6; column++) {
    const value = sum(index => ((states[index*6+row]-anchor[row])-meanOffset[row])*((states[index*6+column]-anchor[column])-meanOffset[column]))/(count-1)
    covariance[row][column] = covariance[column][row] = value
  }
  const mean = anchor.map((value,i) => value+meanOffset[i])
  if (![...mean,...meanOffset,...covariance.flat()].every(Number.isFinite)) throw new RangeError('Ensemble moments exceed numeric range')
  return { status: 'available' as const, count, anchor, meanOffset, mean, covariance,
    standardDeviations: covariance.map((row,i) => Math.sqrt(row[i])), covarianceDivisor: count-1,
    method: 'anchored-compensated-two-pass-sample-moments-v1',
    limitation: 'Descriptive finite-ensemble mean and sample covariance only; no confidence level, convergence, event probability or physical-error calibration. Unavailable when any draw failed.' }
}
