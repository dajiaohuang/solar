import { expect, test } from 'vitest'
import { covarianceEllipsoid } from '../../src/engine/ephemeris/covarianceEllipsoid'
import { parseSbdbCovariance } from '../../src/data/loaders/sbdbCovariance'
import { cartesianCovarianceAtSolutionEpoch } from '../../src/engine/ephemeris/orbitCovariance'
import bennu from '../fixtures/sbdb-bennu-covariance.json'
import eros from '../fixtures/sbdb-eros-covariance.json'

test('sphere mapping reconstructs correlated position covariance without losing thin directions', () => {
  for (const magnitudes of [[1, 1, 1], [1e-150, 1, 1e150], [1e-100, 2e-100, 3e-100]]) {
    const correlation = [[1, .3, -.2], [.3, 1, .1], [-.2, .1, 1]]
    const matrix = correlation.map((row, i) => row.map((value, j) => value*magnitudes[i]*magnitudes[j]))
    const result = covarianceEllipsoid(matrix)
    expect(result.rank).toBe(3)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      // Normalize factors independently to avoid under/overflow in the test.
      const reconstructed = result.factor[i].reduce((sum, value, k) => sum+(value/magnitudes[i])*(result.factor[j][k]/magnitudes[j]), 0)
      expect(reconstructed).toBeCloseTo(correlation[i][j], 14)
    }
  }
})

test('zero and exact rank-one marginals remain degenerate without covariance repair', () => {
  const zero = covarianceEllipsoid([[0,0,0], [0,0,0], [0,0,0]])
  expect(zero.rank).toBe(0)
  expect(zero.radiusBound).toBe(0)
  const line = covarianceEllipsoid([[1,2,-3], [2,4,-6], [-3,-6,9]])
  expect(line.rank).toBe(1)
  expect(line.levels.every(level => level.gaussianProbability3d === null)).toBe(true)
  expect(line.factor).toEqual([[1,0,0], [2,0,0], [-3,0,0]])
})

test('rejects non-PSD, asymmetric and unrepresentable display covariances', () => {
  expect(() => covarianceEllipsoid([[1,2,0], [2,1,0], [0,0,1]])).toThrow('semidefinite')
  expect(() => covarianceEllipsoid([[1,.2,0], [.3,1,0], [0,0,1]])).toThrow('symmetric')
  expect(() => covarianceEllipsoid([[0,1,0], [1,1,0], [0,0,1]])).toThrow('zero variance')
  expect(() => covarianceEllipsoid([[1,0,0], [0,1,0], [0,0,1]], Number.MAX_VALUE)).toThrow('range')
  expect(() => covarianceEllipsoid([[1e-300,0,0], [0,1e-300,0], [0,0,1e-300]], Number.MIN_VALUE)).toThrow('range')
})

for (const [name, source] of [['Bennu', bennu], ['Eros', eros]] as const) test(`${name} full source covariance produces a faithful position marginal without dropping extra axes`, () => {
  const converted = cartesianCovarianceAtSolutionEpoch(parseSbdbCovariance(source), { au3PerDay2: .00029591220828411956, source: 'Explicit fixed numerical test GM' })
  const saved = structuredClone(converted.matrix), geometry = covarianceEllipsoid(converted.matrix, 149597870.7)
  expect(geometry.rank).toBe(3)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const actual = geometry.factor[i].reduce((sum, value, k) => sum+(value/149597870.7)*(geometry.factor[j][k]/149597870.7), 0)
    expect(Math.abs(actual/converted.matrix[i][j]-1)).toBeLessThan(2e-13)
  }
  expect(converted.matrix).toEqual(saved)
  expect(converted.matrix).toHaveLength(name === 'Bennu' ? 8 : 6)
})

