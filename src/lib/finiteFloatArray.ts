/** Avoid per-element callback allocation when validating large typed arrays. */
export function hasOnlyFiniteValues(values: Float32Array | Float64Array) {
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) return false
  }
  return true
}
