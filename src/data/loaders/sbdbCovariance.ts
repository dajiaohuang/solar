/** Full-precision cov=mat only. JPL uses au, degrees and days in this format;
 * cov=src uses different angular units and must not enter this parser.
 * https://ssd-api.jpl.nasa.gov/doc/sbdb.html#orbit-subsection-covariance */
export type SbdbCovariance = {
  designation: string
  spkId: string
  solutionId: string
  solutionDateLocal: string | null
  solutionEpochTdb: number
  standardElementEpochTdb: number
  frame: 'heliocentric-IAU76/80-ecliptic-J2000'
  labels: string[]
  units: (string | null)[]
  nominal: number[]
  matrix: number[][]
  marginalSigmas: number[]
  correlation: number[][]
  correlationEigenvalues: number[]
  positiveDefinite: boolean
  additionalParameters: string[]
  planetaryEphemeris: string | null
  smallBodyEphemeris: string | null
}

export class SbdbCovarianceError extends Error {
  constructor(message: string) { super(message); this.name = 'SbdbCovarianceError' }
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SbdbCovarianceError(`Missing ${name} object`)
  return value as Record<string, unknown>
}
function text(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new SbdbCovarianceError(`Missing ${name}`)
  return value.trim()
}
function number(value: unknown, name: string) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) ||
      !Number.isFinite(Number(value))) {
    throw new SbdbCovarianceError(`Nonfinite or missing ${name}`)
  }
  return Number(value)
}
const optionalText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
const definition: Record<string, { name: string; units: string | null }> = {
  e: { name: 'e', units: null }, q: { name: 'q', units: 'au' }, tp: { name: 'tp', units: 'TDB' },
  node: { name: 'om', units: 'deg' }, peri: { name: 'w', units: 'deg' }, i: { name: 'i', units: 'deg' },
}

/** Symmetric Jacobi rotations on a dimensionless correlation matrix. Raw
 * source covariance is retained; no jitter or eigenvalue clipping is applied. */
function correlationEigenvalues(source: number[][]) {
  const n = source.length, a = source.map(row => row.slice())
  for (let step = 0; step < 64 * n * n; step++) {
    let p = 0, q = 1, largest = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j }
    }
    if (largest <= 8 * Number.EPSILON * n) return a.map((row, index) => row[index]).sort((x, y) => x - y)
    const tau = (a[q][q] - a[p][p]) / (2 * a[p][q])
    const t = (tau < 0 ? -1 : 1) / (Math.abs(tau) + Math.hypot(1, tau))
    const c = 1 / Math.hypot(1, t), s = t * c, cross = a[p][q]
    a[p][p] -= t * cross; a[q][q] += t * cross; a[p][q] = a[q][p] = 0
    for (let k = 0; k < n; k++) {
      if (k === p || k === q) continue
      const kp = a[k][p], kq = a[k][q]
      a[k][p] = a[p][k] = c * kp - s * kq
      a[k][q] = a[q][k] = s * kp + c * kq
    }
  }
  throw new SbdbCovarianceError('Covariance correlation eigensolver did not converge')
}

export function parseSbdbCovariance(payload: unknown): SbdbCovariance {
  const root = object(payload, 'SBDB response'), signature = object(root.signature, 'signature')
  if (signature.version !== '1.3' || signature.source !== 'NASA/JPL Small-Body Database (SBDB) API') {
    throw new SbdbCovarianceError('Unsupported SBDB API signature; expected NASA/JPL version 1.3')
  }
  const body = object(root.object, 'object'), orbit = object(root.orbit, 'orbit')
  const cov = object(orbit.covariance, 'orbit.covariance')
  if (!Array.isArray(cov.labels) || cov.labels.length < 6 || cov.labels.length > 16) throw new SbdbCovarianceError('Covariance exceeds supported audit dimension 6 to 16')
  if (orbit.model_pars != null && (!Array.isArray(orbit.model_pars) || orbit.model_pars.length > 64)) throw new SbdbCovarianceError('Estimated model parameters exceed supported list size 64 or are not an array')
  if (orbit.equinox !== 'J2000') throw new SbdbCovarianceError('Unsupported covariance reference equinox')
  const solutionId = text(orbit.orbit_id, 'orbit solution identifier')
  if (body.orbit_id !== undefined && body.orbit_id !== solutionId) throw new SbdbCovarianceError('Conflicting SBDB orbit solution identifiers')
  const solutionEpochTdb = number(cov.epoch, 'covariance epoch'), standardElementEpochTdb = number(orbit.epoch, 'element epoch')
  if (orbit.cov_epoch != null && number(orbit.cov_epoch, 'declared covariance epoch') !== solutionEpochTdb) {
    throw new SbdbCovarianceError('Conflicting covariance epochs')
  }
  const rawElements = cov.elements ?? (standardElementEpochTdb === solutionEpochTdb ? orbit.elements : null)
  if (!Array.isArray(rawElements)) throw new SbdbCovarianceError('Missing elements at the covariance solution epoch; standard-epoch elements cannot be substituted')
  if (rawElements.length > 64) throw new SbdbCovarianceError('Solution elements exceed supported list size 64')
  const elements = new Map<string, Record<string, unknown>>()
  for (const raw of rawElements) {
    const element = object(raw, 'solution element'), name = text(element.name, 'element name')
    if (elements.has(name)) throw new SbdbCovarianceError(`Duplicate solution element ${name}`)
    elements.set(name, element)
  }
  const labels = cov.labels.map((value, i) => text(value, `covariance label ${i}`)), n = labels.length
  if (new Set(labels).size !== n || labels.slice(0, 6).some(label => !Object.hasOwn(definition, label))) {
    throw new SbdbCovarianceError('Covariance must uniquely label all six orbital elements before additional parameters')
  }
  const models = new Map<string, Record<string, unknown>>()
  for (const raw of (orbit.model_pars ?? []) as unknown[]) {
    const model = object(raw, 'model parameter'), name = text(model.name, 'model parameter name')
    if (models.has(name)) throw new SbdbCovarianceError(`Duplicate model parameter ${name}`)
    models.set(name, model)
  }
  const units: (string | null)[] = [], nominal: number[] = []
  for (const [index, label] of labels.entries()) {
    const def = index < 6 ? definition[label] : null, entry = def ? elements.get(def.name) : models.get(label)
    if (!entry) throw new SbdbCovarianceError(`Missing nominal parameter ${label} at the solution epoch`)
    if (def && (entry.units ?? null) !== def.units) throw new SbdbCovarianceError(`Unexpected units for covariance parameter ${label}`)
    if (!def && entry.kind !== 'EST' && entry.kind !== 'CON') throw new SbdbCovarianceError(`Covariance parameter ${label} is not estimated or considered`)
    // tp's nominal value is a TDB Julian date; covariance differences are days.
    // Missing/null units retain the source convention; malformed units must not
    // silently become dimensionless in readouts or exported covariance axes.
    units.push(def ? label === 'tp' ? 'd' : def.units : entry.units == null ? null : text(entry.units, `units for covariance parameter ${label}`))
    nominal.push(number(entry.value, `nominal ${label}`))
  }
  const e = nominal[labels.indexOf('e')], q = nominal[labels.indexOf('q')], inclination = nominal[labels.indexOf('i')]
  if (e < 0 || q <= 0 || inclination < 0 || inclination > 180) throw new SbdbCovarianceError('Covariance solution has invalid conic elements')
  if (!Array.isArray(cov.data) || cov.data.length !== n) throw new SbdbCovarianceError('Expected cov=mat full square covariance, not vector or square-root form')
  const matrix = cov.data.map((raw, i) => {
    if (!Array.isArray(raw) || raw.length !== n) throw new SbdbCovarianceError('Covariance matrix dimensions disagree with labels')
    return raw.map((value, j) => number(value, `covariance ${i},${j}`))
  })
  const marginalSigmas = matrix.map((row, i) => {
    if (row[i] <= 0) throw new SbdbCovarianceError('This audit requires strictly positive marginal variances')
    return Math.sqrt(row[i])
  })
  // For a valid covariance, |Cij| / min(sigma_i,sigma_j) <= max(sigma_i,sigma_j).
  // Dividing by the larger scale first can underflow a representable correlation.
  const correlation = matrix.map((row, i) => row.map((value, j) =>
    value / Math.min(marginalSigmas[i], marginalSigmas[j]) / Math.max(marginalSigmas[i], marginalSigmas[j])))
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (!Number.isFinite(correlation[i][j]) || Math.abs(correlation[i][j] - correlation[j][i]) > 1e-12 || Math.abs(correlation[i][j]) > 1 + 1e-12) {
      throw new SbdbCovarianceError('Covariance is asymmetric or violates pairwise variance bounds')
    }
    correlation[i][j] = correlation[j][i] = (correlation[i][j] + correlation[j][i]) / 2
  }
  const eigenvalues = correlationEigenvalues(correlation)
  if (eigenvalues[0] < -1e-12) throw new SbdbCovarianceError('Covariance is not positive semidefinite')
  return {
    designation: text(body.des, 'designation'), spkId: text(body.spkid, 'source SPK identifier'), solutionId,
    solutionDateLocal: optionalText(orbit.soln_date), solutionEpochTdb, standardElementEpochTdb,
    frame: 'heliocentric-IAU76/80-ecliptic-J2000', labels, units, nominal, matrix, marginalSigmas,
    correlation, correlationEigenvalues: eigenvalues, positiveDefinite: eigenvalues[0] > 1e-12,
    additionalParameters: labels.slice(6), planetaryEphemeris: optionalText(orbit.pe_used), smallBodyEphemeris: optionalText(orbit.sb_used),
  }
}
