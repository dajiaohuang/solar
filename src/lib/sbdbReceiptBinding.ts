import { COVARIANCE_MATRIX_ARITHMETIC } from '../engine/numerics/compensatedMatrixProduct.ts'
import { parseSbdbModelParameters, sbdbCovarianceModelParameterIssue } from '../data/loaders/sbdbCovariance.ts'

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid SBDB coordinate receipt record')
  return value as Record<string, unknown>
}
const numeric = (value: unknown) => {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) ||
      !Number.isFinite(Number(value))) throw new Error('Invalid SBDB source parameter')
  return Number(value)
}
const text = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid SBDB source label')
  return value.trim()
}
const same = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('SBDB coordinate receipt differs from original solution parameters')
}

/** Metadata binding for the currently supported six-parameter propagation.
 * Does not recompute covariance spectra, Jacobians, conic roots or dynamics. */
export function checkSbdbCoordinateBinding(payload: unknown, value: unknown, kind: 'covariance' | 'ensemble') {
  const original = record(payload), orbit = record(original.orbit), cov = record(orbit.covariance)
  const epoch = numeric(cov.epoch), standardEpoch = numeric(orbit.epoch)
  const definitions: Record<string, { name: string; sourceUnit: string | null; outputUnit: string | null }> = {
    e: { name: 'e', sourceUnit: null, outputUnit: null }, q: { name: 'q', sourceUnit: 'au', outputUnit: 'au' },
    tp: { name: 'tp', sourceUnit: 'TDB', outputUnit: 'd' }, node: { name: 'om', sourceUnit: 'deg', outputUnit: 'deg' },
    peri: { name: 'w', sourceUnit: 'deg', outputUnit: 'deg' }, i: { name: 'i', sourceUnit: 'deg', outputUnit: 'deg' },
  }
  if (!Array.isArray(cov.labels) || cov.labels.length !== 6) throw new Error('Six source axes required for conditional propagation')
  const labels = cov.labels.map(text)
  if (new Set(labels).size !== 6 || labels.some(label => !Object.hasOwn(definitions,label))) throw new Error('Invalid source covariance axes')
  const elements = cov.elements ?? (epoch === standardEpoch ? orbit.elements : null)
  if (!Array.isArray(elements) || elements.length > 64) throw new Error('Missing or oversized covariance solution-epoch elements')
  const byName = new Map<string, Record<string, unknown>>()
  for (const raw of elements) {
    const element = record(raw), name = text(element.name)
    if (byName.has(name)) throw new Error('Duplicate covariance solution element')
    byName.set(name,element)
  }
  const nominal = labels.map(label => {
    const definition = definitions[label], element = byName.get(definition.name)
    if (!element) throw new Error('Missing source orbital parameter')
    same(element.units ?? null,definition.sourceUnit)
    return numeric(element.value)
  })
  const units = labels.map(label => definitions[label].outputUnit), receipt = record(value)
  const initial = kind === 'ensemble' ? record(receipt.initial) : record(receipt.initialCoordinates)
  const source = kind === 'ensemble' ? record(initial.source) : record(receipt.source)
  const modelParameters = parseSbdbModelParameters(orbit.model_pars)
  const modelParameterIssue = sbdbCovarianceModelParameterIssue(labels, modelParameters)
  if (modelParameterIssue) throw new Error(modelParameterIssue)
  same(source.labels,labels); same(source.units,units); same(source.nominal,nominal)
  same(source.solutionEpochTdb,epoch); same(source.standardElementEpochTdb,standardEpoch)
  same(source.solutionId,text(orbit.orbit_id)); same(source.spkId,text(record(original.object).spkid))
  same(source.designation,text(record(original.object).des)); same(source.additionalParameters,[])
  same(source.modelParameters,modelParameters)
  if (!Array.isArray(cov.data) || cov.data.length !== 6) throw new Error('Invalid source covariance matrix shape')
  const matrix = cov.data.map(row => {
    if (!Array.isArray(row) || row.length !== 6) throw new Error('Invalid source covariance matrix row')
    return row.map(numeric)
  })
  same(source.matrix,matrix)
  same(source.frame,'heliocentric-IAU76/80-ecliptic-J2000')
  same(initial.epochTdb,epoch); same(initial.frame,source.frame)
  const conversion = kind === 'ensemble' ? record(initial.nominalCoordinateModel) : initial
  same(conversion.matrixArithmetic,COVARIANCE_MATRIX_ARITHMETIC)
  const conic = record(conversion.nominalConic), domain = record(conversion.numericalDomain)
  const e = nominal[labels.indexOf('e')], q = nominal[labels.indexOf('q')], tp = nominal[labels.indexOf('tp')]
  same(conic.eccentricity,e); same(conic.periapsisAU,q); same(conic.elapsedTdbDaysFromPeriapsis,epoch-tp)
  same(conic.classification,e < 1 ? 'elliptic' : e === 1 ? 'parabolic' : 'hyperbolic')
  const universal = e > .9999
  same(conversion.model,universal ? 'universal-conic-osculating-coordinate-transform' : 'elliptic-osculating-coordinate-transform')
  same(domain.formulation,universal ? 'unwrapped-universal-periapsis' : 'elliptic-anomaly')
  same(domain[universal ? 'maximumAbsoluteDimensionlessTime' : 'maximumAbsoluteMeanAnomalyRadians'],1e6)
  if (kind === 'ensemble') {
    const sampling = record(receipt.sampling)
    same(initial.dimension,6); same(sampling.dimension,6)
    same(sampling.labels,labels); same(sampling.units,units); same(sampling.nominal,nominal)
    same(sampling.solutionEpochTdb,epoch); same(sampling.solutionId,source.solutionId)
    same(initial.stateLabels,['x','y','z','vx','vy','vz'])
    same(initial.stateUnits,['au','au','au','au/d','au/d','au/d'])
  } else {
    same(receipt.method,'first-order-variational-square-root-pushforward')
    same(receipt.matrixArithmetic,COVARIANCE_MATRIX_ARITHMETIC)
    same(initial.inputLabels,labels); same(initial.inputUnits,units)
    same(initial.labels,['x','y','z','vx','vy','vz'])
    same(initial.units,['au','au','au','au/d','au/d','au/d'])
    same(record(initial.source).solutionEpochTdb,epoch)
    same(record(initial.source).solutionId,source.solutionId)
    same(record(initial.source).modelParameters,modelParameters)
    const final = record(receipt.finalCoordinates)
    same(final.frame,source.frame)
    same(final.labels,['x','y','z','vx','vy','vz'])
    same(final.units,['au','au','au','au/d','au/d','au/d'])
    if (receipt.covarianceRefinement !== null) {
      const refined = record(receipt.covarianceRefinement)
      same(refined.frame,final.frame); same(refined.labels,final.labels); same(refined.units,final.units)
    }
  }
}
