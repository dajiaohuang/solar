import type { SbdbCovariance } from '../../data/loaders/sbdbCovariance'

/** Owned correlation factor and source-unit scales. Accepted transpose pairs
 * are averaged; source bytes stay unchanged and no jitter/clipping is applied. */
export function factorSbdbCovariance(source: SbdbCovariance) {
  const dimension = source.labels.length
  if (!source.positiveDefinite) throw new RangeError('Gaussian sampling currently requires positive definite covariance; no jitter or clipping is applied')
  if (dimension < 6 || dimension > 16 || source.matrix.length !== dimension || source.matrix.some(row => row.length !== dimension || row.some(value => !Number.isFinite(value)))) {
    throw new RangeError('Invalid audited covariance dimensions')
  }
  const sigmas = source.matrix.map((row, i) => Math.sqrt(row[i]))
  if (sigmas.some(value => !Number.isFinite(value) || value <= 0)) throw new RangeError('Invalid covariance marginal variances')
  const lower = Array.from({ length: dimension }, () => Array<number>(dimension).fill(0))
  let maximumCorrelationAsymmetry = 0
  for (let i = 0; i < dimension; i++) for (let j = 0; j <= i; j++) {
    const low = Math.min(sigmas[i], sigmas[j]), high = Math.max(sigmas[i], sigmas[j])
    const forward = source.matrix[i][j] / low / high, backward = source.matrix[j][i] / low / high
    if (!Number.isFinite(forward) || !Number.isFinite(backward)) throw new RangeError('Covariance correlation exceeds numeric range')
    if (Math.abs(forward - backward) > 1e-12) throw new RangeError('Asymmetric covariance cannot be sampled')
    maximumCorrelationAsymmetry = Math.max(maximumCorrelationAsymmetry, Math.abs(forward-backward))
    let value = (forward + backward) / 2
    for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k]
    if (!Number.isFinite(value)) throw new RangeError('Covariance factorization exceeds numeric range')
    if (i === j) {
      if (!(value > 0)) throw new RangeError('Covariance factorization is not positive definite; no repair was applied')
      lower[i][j] = Math.sqrt(value)
    } else lower[i][j] = value / lower[j][j]
    if (!Number.isFinite(lower[i][j])) throw new RangeError('Covariance factor exceeds numeric range')
  }
  let maximumCorrelationReconstructionResidual = 0
  for (let i = 0; i < dimension; i++) for (let j = 0; j <= i; j++) {
    const low = Math.min(sigmas[i], sigmas[j]), high = Math.max(sigmas[i], sigmas[j])
    const expected = (source.matrix[i][j]/low/high + source.matrix[j][i]/low/high)/2
    let reconstructed = 0
    for (let k = 0; k <= j; k++) reconstructed += lower[i][k]*lower[j][k]
    const residual = Math.abs(reconstructed-expected)
    if (!Number.isFinite(residual)) throw new RangeError('Covariance factor reconstruction exceeds numeric range')
    maximumCorrelationReconstructionResidual = Math.max(maximumCorrelationReconstructionResidual,residual)
  }
  const factorization = {
    method: 'correlation-symmetry-average-cholesky-v1',
    dimension, correlationSymmetryTolerance: 1e-12,
    maximumCorrelationAsymmetry, maximumCorrelationReconstructionResidual,
    symmetrization: 'Average normalized transpose pairs within the correlation symmetry tolerance; original source matrix is unchanged.',
    limitation: 'No jitter, eigenvalue clipping or positive-definiteness repair. Reconstruction residual is a same-arithmetic consistency diagnostic, not a condition estimate, accuracy bound or independent validation.',
  }
  return { lower, sigmas, dimension, factorization }
}

/** Deterministic joint Gaussian offsets in the source axes. Offsets stay
 * separate from the nominal values so a small tp uncertainty is not rounded
 * away by adding it to a large Julian date. No rejection/resampling of draws. */
export function sampleSbdbCovariance(source: SbdbCovariance, count: number, seed: number) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000 || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('Gaussian sampling requires 1 to 10000 draws and an unsigned 32-bit seed')
  }
  const { lower, sigmas, dimension, factorization } = factorSbdbCovariance(source)
  // Mulberry32's 32-bit operations and Box-Muller mapping are versioned in
  // the result. This is a reproducible simulation stream, not cryptography.
  let state = seed >>> 0, spare: number | undefined
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ state >>> 15, 1 | state)
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value)
    return (((value ^ value >>> 14) >>> 0) + .5) / 4294967296
  }
  const normal = () => {
    if (spare !== undefined) { const value = spare; spare = undefined; return value }
    const radius = Math.sqrt(-2 * Math.log(uniform())), angle = 2 * Math.PI * uniform()
    spare = radius * Math.sin(angle)
    return radius * Math.cos(angle)
  }
  const offsets = new Float64Array(count * dimension), independent = new Float64Array(dimension)
  for (let sample = 0; sample < count; sample++) {
    for (let i = 0; i < dimension; i++) independent[i] = normal()
    for (let i = 0; i < dimension; i++) {
      let value = 0
      for (let j = 0; j <= i; j++) value += lower[i][j] * independent[j]
      offsets[sample * dimension + i] = value * sigmas[i]
      if (!Number.isFinite(offsets[sample * dimension + i])) throw new RangeError('Gaussian source offset exceeds numeric range; no replacement draw was generated')
    }
  }
  return { algorithm: 'mulberry32-box-muller-cholesky-correlation-v2' as const,
    distribution: 'joint-gaussian-in-source-parameter-offsets' as const,
    count, dimension, seed, offsets, labels: source.labels.slice(), units: source.units.slice(), nominal: source.nominal.slice(),
    factorization,
    solutionEpochTdb: source.solutionEpochTdb, solutionId: source.solutionId,
    limitations: ['Formal Gaussian approximation in source parameter space; nonlinear orbit distributions may differ.',
      'All draws are retained, including any that imply invalid physical parameters. No clipping or rejection sampling.',
      'Offsets must remain separate from large nominal Julian dates until relative-time evaluation.',
      'Seed reproduces this versioned arithmetic; transcendentals may differ at the last bit across runtimes.',
      'Sampling does not integrate a force model, propagate uncertainty in time or estimate an event probability.'],
  }
}
