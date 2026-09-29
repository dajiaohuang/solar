export const COVARIANCE_MATRIX_ARITHMETIC = 'neumaier-compensated-f64-dot-v1'

/** Neumaier-compensated Float64 dot product, shared by factorization and pushforward. */
export function compensatedFloat64Dot(a: ArrayLike<number>, b: ArrayLike<number>, length = a.length) {
  if (!Number.isSafeInteger(length) || length < 0 || length > a.length || length > b.length) throw new RangeError('Incompatible dot-product dimensions')
  let sum = 0, correction = 0
  for (let index = 0; index < length; index++) {
    const term = a[index] * b[index]
    if (!Number.isFinite(term)) throw new RangeError('Dot-product term exceeds numeric range')
    const next = sum + term
    correction += Math.abs(sum) >= Math.abs(term) ? (sum - next) + term : (term - next) + sum
    sum = next
    if (!Number.isFinite(sum) || !Number.isFinite(correction)) throw new RangeError('Dot product exceeds numeric range')
  }
  const value = sum + correction
  if (!Number.isFinite(value)) throw new RangeError('Dot product exceeds numeric range')
  return value
}

/** Small dense matrix products used by six-state covariance propagation.
 * Neumaier compensation limits rounding loss in short, cancellation-prone dots. */
export function compensatedMatrixProduct(a: readonly (readonly number[])[], b: readonly (readonly number[])[]) {
  if (!a.length || !b.length || !a[0].length || !b[0].length || a.some(row => row.length !== a[0].length) ||
      b.length !== a[0].length || b.some(row => row.length !== b[0].length)) {
    throw new RangeError('Incompatible matrix product dimensions')
  }
  const result = Array.from({ length: a.length }, () => Array<number>(b[0].length).fill(0))
  const columns = Array.from({ length: b[0].length }, (_, column) => b.map(row => row[column]))
  for (let row = 0; row < a.length; row++) for (let column = 0; column < b[0].length; column++) {
    result[row][column] = compensatedFloat64Dot(a[row], columns[column])
  }
  return result
}
