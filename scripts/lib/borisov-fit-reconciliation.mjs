const FIT_AXES = [
  ['EC', 'e', 'e'], ['QR', 'q', 'q'], ['TP', 'tp', 'tp'],
  ['OM', 'om', 'node'], ['W', 'w', 'peri'], ['IN', 'i', 'i'],
  ['A1', 'A1', 'A1'], ['A2', 'A2', 'A2'], ['A3', 'A3', 'A3'], ['DT', 'DT', 'DT'],
]

// Compare printed Horizons fit values with the pinned SBDB nominal solution
// using SBDB's own formal marginal sigmas, not arbitrary absolute tolerances.
export function reconcileBorisovFit(solution, orbit) {
  const elements = new Map((orbit.elements ?? []).map(element => [element.name, Number(element.value)]))
  const modelParameters = new Map((orbit.model_pars ?? []).map(parameter => [parameter.name, Number(parameter.value)]))
  const covariance = orbit.covariance
  const labels = covariance?.labels ?? []
  const matrix = covariance?.data ?? []
  if (labels.length !== 10 || matrix.length !== labels.length || matrix.some(row => row.length !== labels.length)) {
    throw new Error('Borisov SBDB covariance does not contain the expected ten fit axes')
  }

  const parameters = {}
  for (const [horizonsName, sbdbName, covarianceLabel] of FIT_AXES) {
    const expected = (['A1', 'A2', 'A3', 'DT'].includes(sbdbName) ? modelParameters : elements).get(sbdbName)
    if (!Number.isFinite(expected)) throw new Error(`Missing pinned SBDB Borisov parameter ${sbdbName}`)

    const match = new RegExp(`(?:^|\\s)${horizonsName}=\\s*([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[Ee][+-]?\\d+)?)`, 'm').exec(solution)
    const horizonsNominal = match ? Number(match[1]) : Number.NaN
    const axis = labels.indexOf(covarianceLabel)
    const variance = axis >= 0 ? matrix[axis][axis] : Number.NaN
    const sbdbFormalSigma = Math.sqrt(variance)
    const absoluteDifference = Math.abs(horizonsNominal - expected)
    const standardizedDifference = absoluteDifference / sbdbFormalSigma
    if (!Number.isFinite(horizonsNominal) || !Number.isFinite(sbdbFormalSigma) || sbdbFormalSigma <= 0
      || !Number.isFinite(standardizedDifference) || standardizedDifference > 1) {
      throw new Error(`Horizons Borisov ${horizonsName} differs from pinned SBDB solution 54 by more than one formal sigma`)
    }
    parameters[horizonsName] = {
      horizonsNominal,
      sbdbNominal: expected,
      absoluteDifference,
      sbdbFormalSigma,
      standardizedDifference,
    }
  }

  const largest = Object.entries(parameters).reduce((current, entry) =>
    entry[1].standardizedDifference > current[1].standardizedDifference ? entry : current)
  return {
    parameters,
    maxStandardizedDifference: largest[1].standardizedDifference,
    maxDifferenceParameter: largest[0],
  }
}
