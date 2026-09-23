import { expect, test } from 'vitest'
import { summarizeEnsembleEndpoints } from '../../src/engine/dynamics/ensembleMoments'

test('anchored moments retain exact small-spread covariance around a large origin', () => {
  const ulp = 2**-12, coefficients = [1,-2,3,-4,5,-6]
  const states = new Float64Array([0,1,3].flatMap(t => coefficients.map(c => 2**40+t*c*ulp)))
  const result = summarizeEnsembleEndpoints(states,new Uint8Array([1,1,1]))
  expect(result.status).toBe('available')
  if (result.status !== 'available') throw new Error('Expected moments')
  expect(result.covarianceDivisor).toBe(2)
  for (let i = 0; i < 6; i++) {
    expect(result.meanOffset[i]).toBeCloseTo(coefficients[i]*ulp*4/3,16)
    for (let j = 0; j < 6; j++) expect(Math.abs(result.covariance[i][j]/(coefficients[i]*coefficients[j]*ulp**2*7/3)-1)).toBeLessThan(1e-15)
  }
  const relative = summarizeEnsembleEndpoints(states.map(v => v-2**40),new Uint8Array([1,1,1]))
  expect(relative.status === 'available' && relative.covariance).toEqual(result.covariance)
})

test('failed draws cannot silently become a survivor-only distribution', () => {
  const states = new Float64Array(18); states.fill(NaN,6,12)
  expect(summarizeEnsembleEndpoints(states,new Uint8Array([1,0,1]))).toEqual({ status: 'unavailable',reason: 'failed-draws',count: 3 })
  expect(summarizeEnsembleEndpoints(new Float64Array(6),new Uint8Array([1]))).toEqual({ status: 'unavailable',reason: 'insufficient-draws',count: 1 })
  expect(() => summarizeEnsembleEndpoints(states,new Uint8Array([1,1,1]))).toThrow('finite')
  expect(() => summarizeEnsembleEndpoints(new Float64Array(6),new Uint8Array([2]))).toThrow('indexed')
})

test('identical endpoints have zero spread without requiring positive-definite sample covariance', () => {
  const result = summarizeEnsembleEndpoints(new Float64Array(12).fill(1),new Uint8Array([1,1]))
  expect(result.status).toBe('available')
  if (result.status !== 'available') throw new Error('Expected moments')
  expect(result.mean).toEqual(Array(6).fill(1))
  expect(result.standardDeviations).toEqual(Array(6).fill(0))
  expect(result.covariance).toEqual(Array.from({length: 6},() => Array(6).fill(0)))
})
