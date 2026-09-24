import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseSbdbCovariance } from '../../src/data/loaders/sbdbCovariance'
import { cartesianCovarianceAtSolutionEpoch } from '../../src/engine/ephemeris/orbitCovariance'
import eros from '../fixtures/sbdb-eros-covariance.json'
import bennu from '../fixtures/sbdb-bennu-covariance.json'
import reference from '../fixtures/orbit-covariance-reference.json'

const gm = reference.adoptedSolarGM

it('binds the independent reference to the exact high-precision generator', () => {
  expect(createHash('sha256').update(readFileSync(reference.generatorPath)).digest('hex')).toBe(reference.generatorSha256)
  expect(createHash('sha256').update(readFileSync('src/data/gm_de440.tpc')).digest('hex')).toBe(reference.gmFileSha256)
})

it.each(reference.cases)('matches independent 80-digit state, Jacobian and covariance for $name', sample => {
  const source = parseSbdbCovariance(sample.name === 'bennu' ? bennu : eros)
  if (sample.sourceSha256) {
    expect(createHash('sha256').update(readFileSync(sample.sourcePath!)).digest('hex')).toBe(sample.sourceSha256)
  }
  if (sample.name === 'eros' || sample.name === 'bennu') {
    expect(source.nominal).toEqual(sample.nominal)
    expect(source.matrix).toEqual(sample.matrix)
  } else {
    if (sample.covarianceEvidence) expect(sample.covarianceEvidence).toMatch(/^Synthetic positive-definite matrix;/)
    source.nominal = sample.nominal
    source.solutionEpochTdb = sample.epochTdb
    source.matrix = sample.matrix
  }
  const before = JSON.stringify(source), result = cartesianCovarianceAtSolutionEpoch(source, gm)
  expect(JSON.stringify(source)).toBe(before)
  expect(result.epochTdb).toBe(sample.epochTdb)
  expect(result.labels).toEqual(['x', 'y', 'z', 'vx', 'vy', 'vz', ...sample.labels.slice(6)])
  expect(result.adoptedSolarGM).toEqual(gm)
  for (let row = 0; row < source.labels.length; row++) {
    expect(Math.abs(result.nominal[row] - sample.referenceNominal[row])).toBeLessThan(1e-11 * Math.max(1, Math.abs(sample.referenceNominal[row])))
    if (sample.cspiceNominal && row < 6) expect(Math.abs(result.nominal[row] - sample.cspiceNominal[row])).toBeLessThan(1e-10 * Math.max(1, Math.abs(sample.cspiceNominal[row])))
    for (let column = 0; column < source.labels.length; column++) {
      const derivativeScale = Math.max(...sample.referenceJacobian.slice(row < 3 ? 0 : 3, row < 3 ? 3 : 6).map(values => Math.abs(values[column])), 1e-12)
      expect(Math.abs(result.jacobian[row][column] - sample.referenceJacobian[row][column])).toBeLessThan(1e-9 * derivativeScale)
      const covarianceScale = Math.sqrt(sample.referenceMatrix[row][row] * sample.referenceMatrix[column][column])
      expect(Math.abs(result.matrix[row][column] - sample.referenceMatrix[row][column])).toBeLessThan(1e-8 * Math.max(covarianceScale, 1e-50))
      expect(result.matrix[row][column]).toBe(result.matrix[column][row])
    }
  }
})

it('retains the full Bennu joint vector, model variances and state-model cross correlations', () => {
  const source = parseSbdbCovariance(bennu), result = cartesianCovarianceAtSolutionEpoch(source, gm)
  expect(result.labels.slice(6)).toEqual(['RHO', 'AMRAT'])
  expect(result.units.slice(6)).toEqual(['kg/m^3', 'm^2/kg'])
  expect(result.nominal.slice(6)).toEqual(source.nominal.slice(6))
  expect(result.matrix.slice(6).map(row => row.slice(6))).toEqual(source.matrix.slice(6).map(row => row.slice(6)))
  expect(result.matrix.slice(0, 6).every(row => row[6] !== 0 && row[7] !== 0)).toBe(true)
  expect(result.jacobian.slice(6)).toEqual([[0, 0, 0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 0, 0, 1]])
})

it('maps permuted source axes consistently and cannot substitute the standard epoch', () => {
  const source = parseSbdbCovariance(eros), expected = cartesianCovarianceAtSolutionEpoch(source, gm)
  const order = [5, 3, 1, 0, 2, 4]
  const permuted = { ...source, labels: order.map(i => source.labels[i]), units: order.map(i => source.units[i]),
    nominal: order.map(i => source.nominal[i]), matrix: order.map(i => order.map(j => source.matrix[i][j])) }
  const result = cartesianCovarianceAtSolutionEpoch(permuted, gm)
  expect(result.nominal).toEqual(expected.nominal)
  result.matrix.forEach((row, i) => row.forEach((value, j) => expect(Math.abs(value - expected.matrix[i][j])).toBeLessThan(1e-28)))
  const differentStandard = { ...source, standardElementEpochTdb: source.standardElementEpochTdb + 36525 }
  expect(cartesianCovarianceAtSolutionEpoch(differentStandard, gm).nominal).toEqual(expected.nominal)
  expect(expected.epochTdb).not.toBe(source.standardElementEpochTdb)
})

it('requires an explicit GM and rejects physically invalid conics, malformed axes and nonfinite values', () => {
  const source = parseSbdbCovariance(eros)
  for (const invalid of [{ ...gm, au3PerDay2: 0 }, { ...gm, au3PerDay2: NaN }, { ...gm, source: '' }]) {
    expect(() => cartesianCovarianceAtSolutionEpoch(source, invalid)).toThrow(/GM/)
  }
  expect(() => cartesianCovarianceAtSolutionEpoch({ ...source, nominal: [-.1, ...source.nominal.slice(1)] }, gm)).toThrow(/requires e >= 0/)
  expect(() => cartesianCovarianceAtSolutionEpoch({ ...source, solutionEpochTdb: NaN }, gm)).toThrow(/contract/)
  expect(() => cartesianCovarianceAtSolutionEpoch({ ...source, matrix: [[NaN]] }, gm)).toThrow(/contract/)
  expect(() => cartesianCovarianceAtSolutionEpoch({ ...source, units: ['rad', ...source.units.slice(1)] }, gm)).toThrow(/contract/)
})
