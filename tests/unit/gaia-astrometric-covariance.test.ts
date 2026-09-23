import { test, expect } from 'vitest'
import { gaiaAstrometricCovariance } from '../../src/lib/gaiaAstrometricCovariance'
import type { GaiaSource } from '../../src/lib/gaiaChunks'
import chunk from '../fixtures/gaia-pleiades-20260923/r11-d22.json'
import extended from '../fixtures/gaia-six-20260923/r11-d22.json'
const fields = ['ra','dec','parallax','pmra','pmdec']
const diagonal = () => {
  const source = { ...chunk.sources[0], astrometric_params_solved:31 } as GaiaSource
  fields.forEach((field,i) => { source[`${field}_error`] = i+1 })
  fields.forEach((a,i) => fields.slice(i+1).forEach(b => { source[`${a}_${b}_corr`] = 0 }))
  return source
}
test('constructs the full sourced pseudocolour covariance and preserves its five-coordinate marginal', () => {
  const rows = extended.sources.filter(row=>row.astrometric_params_solved===95)
  expect(rows).toHaveLength(15)
  for (const row of rows) {
    const full=gaiaAstrometricCovariance(row as GaiaSource,6), marginal=gaiaAstrometricCovariance(row as GaiaSource)
    expect(full.available).toBe(true); expect(marginal.available).toBe(true)
    if (!full.available || !marginal.available) continue
    expect(full.matrix).toHaveLength(6)
    expect(full.coordinateUnits[5]).toBe('inverse-micrometre')
    expect(full.matrix.slice(0,5).map(row=>row.slice(0,5))).toEqual(marginal.matrix)
    expect(full.matrix[5][5]).toBe(row.pseudocolour_error!**2)
    fields.forEach((field,i)=>expect(full.matrix[i][5]).toBe((row as GaiaSource)[`${field}_pseudocolour_corr`] as number * ((row as GaiaSource)[`${field}_error`] as number) * row.pseudocolour_error!))
  }
  expect(gaiaAstrometricCovariance(diagonal(),6).available).toBe(false)
  expect(gaiaAstrometricCovariance({...rows[0],pseudocolour_error:null} as GaiaSource,6).available).toBe(false)
  const invalid={...diagonal(),astrometric_params_solved:95,pseudocolour_error:1} as GaiaSource
  fields.forEach(field=>{invalid[`${field}_pseudocolour_corr`]=.9})
  expect(gaiaAstrometricCovariance(invalid).available).toBe(true)
  expect(gaiaAstrometricCovariance(invalid,6)).toMatchObject({available:false,reason:'joint-matrix-not-numerically-positive-definite'})
})
test('constructs a mixed-unit five-coordinate covariance without an extra cos(dec)', () => {
  const source = diagonal(); source.dec = 89; source.ra_pmdec_corr = .25
  const result = gaiaAstrometricCovariance(source)
  expect(result.available).toBe(true)
  if (!result.available) return
  expect(result.matrix).toEqual([[1,0,0,0,1.25],[0,4,0,0,0],[0,0,9,0,0],[0,0,0,16,0],[1.25,0,0,0,25]])
  expect(result.coordinateUnits).toEqual(['mas','mas','mas','mas/Julian-year','mas/Julian-year'])
  expect(result.propagated).toBe(false)
  const six = gaiaAstrometricCovariance({...source,astrometric_params_solved:95})
  expect(six.available && six.sourceSolutionParameters).toBe(6)
  expect(six.available && six.pseudocolourIncluded).toBe(false)
})
test('rejects invalid joint matrices even if every pairwise correlation is valid', () => {
  const source = diagonal()
  source.ra_dec_corr = -.9; source.ra_parallax_corr = -.9; source.dec_parallax_corr = -.9
  expect(gaiaAstrometricCovariance(source)).toMatchObject({available:false,reason:'joint-matrix-not-numerically-positive-definite'})
  expect(gaiaAstrometricCovariance({...diagonal(),ra_dec_corr:1}).available).toBe(false)
  for (const patch of [{ref_epoch:2020},{astrometric_params_solved:3},{ra_error:null},{ra_error:1e300},{ra_error:1e-300},{pmra_pmdec_corr:null}]) expect(gaiaAstrometricCovariance({...diagonal(),...patch}).available).toBe(false)
})
test('retains all real-source marginal variances and correlations', () => {
  for (const source of chunk.sources) {
    const result = gaiaAstrometricCovariance(source as GaiaSource)
    if (source.astrometric_params_solved === 3) {
      expect(result).toMatchObject({available:false,reason:'five-parameter-solution-unavailable'})
      continue
    }
    expect(result.available).toBe(true)
    if (!result.available) continue
    fields.forEach((field,i) => {
      const sigma = (source as GaiaSource)[`${field}_error`] as number
      expect(result.matrix[i][i]).toBe(sigma*sigma)
      fields.slice(i+1).forEach((other,k) => {
        const j=i+k+1, r=(source as GaiaSource)[`${field}_${other}_corr`] as number
        expect(result.matrix[i][j]).toBe(result.matrix[j][i])
        expect(result.matrix[i][j]/sigma/((source as GaiaSource)[`${other}_error`] as number)).toBeCloseTo(r,14)
      })
    })
  }
})
