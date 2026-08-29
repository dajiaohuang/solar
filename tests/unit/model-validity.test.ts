import { describe, expect, it } from 'vitest'
import {
  EARTH_MOON_MASS_PARTITION_EVIDENCE,
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
      earthOrbitSeed: 'earth-moon-barycenter',
      renderedEarthPoint: 'earth-geocenter',
    })
    expect(majorBodiesById.get('earth')).toMatchObject({
      orbitRepresents: 'earth-moon-barycenter',
      positionRepresents: 'earth-geocenter',
    })
  })

  it('publishes the exact DE440 Earth-Moon mass partition', () => {
    expect(EARTH_MOON_MASS_PARTITION_EVIDENCE).toMatchObject({
      id: 'de440-earth-moon-gm-partition-v1',
      sourceUrl: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc',
      sourceSha256: '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140',
      unit: 'km^3 s^-2',
      earthGm: '3.9860043550702266E+05',
      moonGm: '4.9028001184575496E+03',
      systemGm: '4.0350323562548019E+05',
      orbitSeed: 'earth-moon-barycenter',
      renderedEarthPoint: 'earth-geocenter',
      composition: 'mass-weighted-two-body-partition',
    })
  })

  it('publishes the fixed-ellipse satellite propagation and precision boundary', () => {
    expect(SATELLITE_ORBIT_MODEL_EVIDENCE).toMatchObject({
      id: 'satellite-two-body-contract-v2',
      sourceUrl: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html',
      sourceWarning: 'fixed-mean-and-epoch-osculating-ellipses-not-continuous-ephemerides',
      propagation: 'fixed-ellipse-mean-anomaly-only',
      moonElementType: 'mean-elements',
      giantSatelliteElementType: 'geometric-osculating-elements',
      giantSatelliteSourceFrame: 'ecliptic-of-j2000',
      giantSatelliteFrameTransform: 'identity-eclipj2000',
      sourceEpoch: 'JD 2451545.0 TDB',
      moonSourceCenter: 'earth-geocenter',
      moonAppliedCenter: 'earth-geocenter',
      moonCenterHandling: 'de440-gm-barycentric-partition',
      sourcedBodies: ['moon', 'io', 'europa', 'ganymede', 'callisto', 'titan'],
      illustrativeBodies: [],
    })
    expect(en.satelliteMeanElementsWarning).toContain('not a continuous ephemeris')
    expect(en.satelliteMeanElementsWarning).toContain('ECLIPJ2000')
    expect(en.satelliteMeanElementsWarning).toContain('time-scale conversion')
    expect(en.satelliteMeanElementsWarning).toContain('DE440')
    expect(zh.satelliteMeanElementsWarning).toContain('不是连续星历')
    expect(zh.satelliteMeanElementsWarning).toContain('ECLIPJ2000')
    expect(zh.satelliteMeanElementsWarning).toContain('时标转换')
    expect(zh.satelliteMeanElementsWarning).toContain('DE440')
  })
})
