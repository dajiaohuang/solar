import { expect, it } from 'vitest'
import { parseSbdbCovariance } from '../../src/data/loaders/sbdbCovariance'
import { sampleSbdbCovariance } from '../../src/engine/ephemeris/covarianceSampling'
import bennu from '../fixtures/sbdb-bennu-covariance.json'

it('reproduces a seeded joint sample, retains all axes, and separates tiny time offsets', () => {
  const source = parseSbdbCovariance(bennu), before = JSON.stringify(source)
  const first = sampleSbdbCovariance(source, 100, 42)
  expect(sampleSbdbCovariance(source, 100, 42)).toEqual(first)
  expect(sampleSbdbCovariance(source, 100, 43).offsets).not.toEqual(first.offsets)
  expect(JSON.stringify(source)).toBe(before)
  expect(first.labels.slice(6)).toEqual(['RHO', 'AMRAT'])
  expect(first.offsets.byteLength).toBe(100 * 8 * 8)
  expect(first.nominal).toEqual(source.nominal)
  const small = { ...source, matrix: source.matrix.map(row => row.map(value => value * 1e-20)) }
  const offsets = sampleSbdbCovariance(small, 2, 42).offsets
  expect(offsets[2]).not.toBe(0)
  expect(source.nominal[2] + offsets[2]).toBe(source.nominal[2])
})

it('reproduces Bennu marginal scales and cross correlations in 10000 fixed-seed draws', () => {
  const source = parseSbdbCovariance(bennu), { count, dimension, offsets } = sampleSbdbCovariance(source, 10000, 0)
  const means = Array<number>(dimension).fill(0)
  const products = Array.from({ length: dimension }, () => Array<number>(dimension).fill(0))
  for (let sample = 0; sample < count; sample++) for (let i = 0; i < dimension; i++) {
    const a = offsets[sample * dimension + i] / source.marginalSigmas[i]
    means[i] += a / count
    for (let j = 0; j < dimension; j++) products[i][j] += a * offsets[sample * dimension + j] / source.marginalSigmas[j] / count
  }
  means.forEach(value => expect(Math.abs(value)).toBeLessThan(.04))
  products.forEach((row, i) => row.forEach((value, j) => {
    expect(Math.abs(value - means[i] * means[j] - source.correlation[i][j])).toBeLessThan(.06)
  }))
})

it('does not silently remove physically invalid draws from a broad formal Gaussian', () => {
  const source = parseSbdbCovariance(bennu)
  source.matrix = source.matrix.map((row, i) => row.map((_, j) => i === j ? 1 : 0))
  const result = sampleSbdbCovariance(source, 100, 2)
  const eccentricities = Array.from({ length: 100 }, (_, i) => source.nominal[0] + result.offsets[i * result.dimension])
  expect(eccentricities.some(e => e < 0)).toBe(true)
  expect(eccentricities.some(e => e > 1)).toBe(true)
  expect(result.count).toBe(100)
})

it('bounds work and rejects singular, indefinite and asymmetric matrices without repairs', () => {
  const source = parseSbdbCovariance(bennu)
  for (const count of [0, -1, 10001, 1.5]) expect(() => sampleSbdbCovariance(source, count, 0)).toThrow(/draws/)
  for (const seed of [-1, 2 ** 32, NaN, .5]) expect(() => sampleSbdbCovariance(source, 1, seed)).toThrow(/seed/)
  expect(() => sampleSbdbCovariance({ ...source, positiveDefinite: false }, 1, 0)).toThrow(/positive definite/)
  const singular = { ...source, matrix: source.matrix.map(row => row.map(() => 1)) }
  expect(() => sampleSbdbCovariance(singular, 1, 0)).toThrow(/no repair/)
  const asymmetric = structuredClone(source)
  asymmetric.matrix[0][1] *= 2
  expect(() => sampleSbdbCovariance(asymmetric, 1, 0)).toThrow(/Asymmetric/)
})
