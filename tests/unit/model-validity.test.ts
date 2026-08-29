import { describe, expect, it } from 'vitest'
import {
  JPL_APPROX_MODEL_EVIDENCE,
  JPL_APPROX_VALIDITY_LABEL,
  SATELLITE_ORBIT_MODEL_EVIDENCE,
  jplApproxValidityState,
  jplApproxValidityWarning,
  jplApproxWindowState,
  jplApproxWindowWarning,
} from '../../src/engine/ephemeris/modelValidity'
import { majorBodiesById } from '../../src/data/majorBodies'
import { en } from '../../src/i18n/en'
import { zh } from '../../src/i18n/zh'
import { dateToJulianDay } from '../../src/lib/julianDate'

describe('JPL approximate element validity', () => {
  const jd = (date: string) => dateToJulianDay(new Date(`${date}T00:00:00Z`))

  it('treats the complete 1800–2050 Table 1 interval as valid and labels extrapolation outside it', () => {
    expect(jplApproxValidityWarning(jd('1800-01-01'))).toBeNull()
    expect(jplApproxValidityWarning(jd('2050-12-31'))).toBeNull()
    expect(jplApproxValidityState(jd('1799-12-31'))).toBe('extrapolated')
    expect(jplApproxValidityState(jd('2051-01-01'))).toBe('extrapolated')
    expect(jplApproxValidityWarning(jd('2051-01-01'))).toContain('outside')
    expect(jplApproxValidityWarning(jd('1799-12-31'), 'zh')).toContain('超出')
    expect(jplApproxWindowWarning(jd('2049-01-01'), jd('2051-01-01'))).toContain('2051')
    expect(jplApproxValidityWarning(jd('2051-01-01'))).toContain(JPL_APPROX_VALIDITY_LABEL)
    expect(jplApproxWindowState(jd('1800-01-01'), jd('2050-12-31'))).toBe('within-validity')
    expect(jplApproxWindowState(jd('1799-12-31'), jd('2050-12-31'))).toBe('extrapolated')
  })

  it('publishes the exact JPL Table 1 and Earth–Moon barycenter model identity', () => {
    expect(JPL_APPROX_MODEL_EVIDENCE).toMatchObject({
      id: 'jpl-approx-table-1',
      coordinateFrame: 'mean-ecliptic-and-equinox-of-j2000',
      sourceTimeScale: 'JDTDB',
      applicationTimeHandling: 'utc-derived-numeric-jd-without-tdb-conversion',
      validFrom: '1800-01-01',
      validTo: '2050-12-31',
      earthPoint: 'earth-moon-barycenter',
    })
    expect(majorBodiesById.get('earth')?.positionRepresents).toBe('earth-moon-barycenter')
    expect(en.earthMoonBarycenterDisclosure).toContain('Earth–Moon barycenter')
    expect(zh.earthMoonBarycenterDisclosure).toContain('地月质心')
  })

  it('publishes the fixed-ellipse satellite propagation and precision boundary', () => {
    expect(SATELLITE_ORBIT_MODEL_EVIDENCE).toMatchObject({
      id: 'satellite-two-body-contract-v1',
      sourceUrl: 'https://ssd.jpl.nasa.gov/sats/elem/',
      sourceWarning: 'mean-elements-not-intended-for-ephemeris-computation',
      propagation: 'fixed-ellipse-mean-anomaly-only',
      moonSourceCenter: 'earth-geocenter',
      moonAppliedCenter: 'earth-moon-barycenter-seed',
      moonCenterHandling: 'untransformed-pending-geocenter-correction',
      approximateMeanCenterOffsetKm: 4700,
      centerCorrectionIssue: 'https://github.com/dajiaohuang/solar/issues/21',
      sourcedBodies: ['moon'],
      illustrativeBodies: ['io', 'europa', 'ganymede', 'callisto', 'titan'],
    })
    expect(en.satelliteMeanElementsWarning).toContain('not intended for ephemeris')
    expect(en.satelliteMeanElementsWarning).toContain('illustrative')
    expect(en.satelliteMeanElementsWarning).toContain('Earth-geocentric')
    expect(en.satelliteMeanElementsWarning).toContain('Earth–Moon barycenter')
    expect(en.satelliteMeanElementsWarning).toContain('#21')
    expect(zh.satelliteMeanElementsWarning).toContain('不用于星历')
    expect(zh.satelliteMeanElementsWarning).toContain('示意')
    expect(zh.satelliteMeanElementsWarning).toContain('地心')
    expect(zh.satelliteMeanElementsWarning).toContain('地月质心')
    expect(zh.satelliteMeanElementsWarning).toContain('#21')
  })
})
