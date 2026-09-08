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
import { defaultSelectedBodyIds, majorBodiesById } from '../../src/data/majorBodies'
import ephemerisBodies from '../../src/data/ephemerisBodies.json'
import ephemerisManifest from '../../src/data/ephemeris-manifest.json'
import ephemerisManifestFull from '../../src/data/ephemeris-manifest-full.json'
import { JPL_HORIZONS_GIANT_SATELLITE_ELEMENTS } from '../../src/data/satelliteEpochElements'
import satelliteCatalog from '../../src/data/satelliteCatalog.json'
import { en } from '../../src/i18n/en'
import { zh } from '../../src/i18n/zh'
import { dateToJulianDay } from '../../src/lib/julianDate'
import modelEvidence from '../../src/data/modelEvidence.json'

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

  it('keeps the published coverage inventory aligned with implemented named bodies', () => {
    const coverage = modelEvidence.coverage
    expect(coverage.supportedNamedBodies).toEqual(['sun', ...defaultSelectedBodyIds])
    expect(coverage.sourcedSatelliteBodies).toEqual(SATELLITE_ORBIT_MODEL_EVIDENCE.sourcedBodies)
    expect(coverage.sourcedSatelliteBodies.every((bodyId) => majorBodiesById.get(bodyId)?.satelliteOrbitEvidence)).toBe(true)
    expect(coverage.coverageGaps).toEqual([
      'other-planetary-satellites-not-modeled',
      'dwarf-planet-elements-are-curated-approximations-not-precision-ephemerides',
    ])
    for (const bodyId of ['io', 'europa', 'ganymede', 'callisto', 'titan'] as const) {
      expect(JPL_HORIZONS_GIANT_SATELLITE_ELEMENTS[bodyId]).toBeDefined()
    }
  })

  it('publishes the pinned full-profile outer-planet satellite batch', () => {
    const spkDelivery = modelEvidence.coverage.spkDelivery
    expect(spkDelivery).toMatchObject({
      stateBoundary: 'geometric-spk-six-vector-when-kernel-and-center-chain-cover-epoch',
      ephemerisBodyCount: 46,
      planetarySatelliteBodyCount: 31,
      smallBodyBodyCount: 15,
      satelliteIdentityCount: 472,
      pagesManifest: {
        id: ephemerisManifest.id,
        sha256: '5c390d7bb8e02a28ebe45d32979c2f5db12983f8ec6044e4206750c5c89c29e0',
        bytes: 270908416,
        fileCount: 510,
      },
      fullManifest: {
        id: ephemerisManifestFull.id,
        sha256: '7e7fa1df8080b505abba52cc8ca9a4d8bd6d1c10d47d3e421953e7c1b8494257',
        bytes: 1147897856,
        fileCount: 510,
      },
    })
    expect(ephemerisBodies.bodies).toHaveLength(spkDelivery.ephemerisBodyCount)
    expect(ephemerisBodies.bodies.filter((body) => body.kind === 'moon')).toHaveLength(spkDelivery.planetarySatelliteBodyCount)
    expect(ephemerisBodies.bodies.filter((body) => body.kind === 'asteroid')).toHaveLength(spkDelivery.smallBodyBodyCount)
    expect(satelliteCatalog.bodies).toHaveLength(spkDelivery.satelliteIdentityCount)

    const ephemerisById = new Map(ephemerisBodies.bodies.map((body) => [body.id, body]))
    const fullTargets = new Set(ephemerisManifestFull.files.flatMap((file) => file.targets ?? []).map(String))
    for (const [parent, bodyIds] of Object.entries(spkDelivery.sourceBackedSatelliteBatches)) {
      expect(bodyIds).toHaveLength(parent === 'jupiter' ? 4 : parent === 'saturn' ? 8 : parent === 'uranus' ? 5 : 2)
      for (const bodyId of bodyIds) {
        const body = ephemerisById.get(bodyId)
        expect(body?.parentId).toBe(parent)
        expect(fullTargets.has(String(body?.naifId))).toBe(true)
      }
    }
  })
})
