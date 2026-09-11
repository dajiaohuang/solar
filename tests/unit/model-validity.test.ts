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
      ephemerisBodyCount: 238,
      planetarySatelliteBodyCount: 142,
      smallBodyBodyCount: 96,
      satelliteIdentityCount: 472,
      pagesManifest: {
        id: ephemerisManifest.id,
        sha256: 'b326ba67ab67ad6a00908f6f5f03cb7742346ab48fc7375b8fc5c66dc2354943',
        bytes: 272921600,
        fileCount: 602,
      },
      fullManifest: {
        id: ephemerisManifestFull.id,
        sha256: 'f6c06e2c31afb87e184d3dde4060ca18177130198e5b2edf2c18f5f0fb15c5d4',
        bytes: 1167867904,
        fileCount: 602,
      },
    })
    expect(ephemerisBodies.bodies).toHaveLength(spkDelivery.ephemerisBodyCount)
    expect(ephemerisBodies.bodies.filter((body) => body.kind === 'moon')).toHaveLength(spkDelivery.planetarySatelliteBodyCount)
    expect(ephemerisBodies.bodies.filter((body) => body.kind === 'asteroid')).toHaveLength(spkDelivery.smallBodyBodyCount)
    expect(satelliteCatalog.bodies).toHaveLength(spkDelivery.satelliteIdentityCount)
    expect(spkDelivery.sourceBackedSmallBodyPrimaries).toEqual(satelliteCatalog.primaries.map((body) => body.id))

    const numericSatelliteIds = satelliteCatalog.bodies
      .filter((body) => Number.isSafeInteger(body.naifId))
      .map((body) => body.naifId as number)
    const identityOnlyIds = satelliteCatalog.bodies
      .filter((body) => !Number.isSafeInteger(body.naifId))
      .map((body) => body.id)
    const pagesTargets = new Set(ephemerisManifest.files.flatMap((file) => file.targets ?? []))
    const fullTargets = new Set(ephemerisManifestFull.files.flatMap((file) => file.targets ?? []))
    expect(spkDelivery.satelliteIdentityDelivery).toEqual({
      catalogBodies: 472,
      numericNaifIdentities: 471,
      pagesManifestTargets: 471,
      fullManifestTargets: 471,
      identityOnlyBodies: 1,
      identityOnlyIds: ['sat:planet:saturn:provisional:S/2009 S1'],
      sourceOnlyBodies: 2,
      sourceOnlyIds: ['naif:120000617', 'naif:920000617'],
      sourceOnlyBoundary: 'JPL082 publishes explicit Patroclus/Manoetius component offsets but omits compatible system target 20000617; these identities remain source-only and never imply an exact state or local orbit.',
      boundary: 'A pinned manifest target proves source delivery identity; an exact state still requires verified kernel bytes and a covered center chain at the requested epoch.',
      localOrbitBoundary: 'Catalog identities without generated local orbit elements remain source-backed current-state candidates; no fallback orbit is created for them.',
    })
    expect(new Set(numericSatelliteIds)).toHaveLength(471)
    expect(identityOnlyIds).toEqual(['sat:planet:saturn:provisional:S/2009 S1'])
    expect(satelliteCatalog.sourceOnlyBodies).toHaveLength(spkDelivery.satelliteIdentityDelivery.sourceOnlyBodies)
    expect(satelliteCatalog.sourceOnlyBodies.map((body) => body.id).sort()).toEqual(spkDelivery.satelliteIdentityDelivery.sourceOnlyIds)
    expect(numericSatelliteIds.every((id) => pagesTargets.has(id) && fullTargets.has(id))).toBe(true)

    const ephemerisById = new Map(ephemerisBodies.bodies.map((body) => [body.id, body]))
    const fullTargetStrings = new Set([...fullTargets].map(String))
    const expectedBatchLengths = { mars: 2, jupiter: 106, saturn: 22, uranus: 5, neptune: 2, pluto: 5 }
    const sourceBackedIds = new Set<string>()
    for (const [parent, bodyIds] of Object.entries(spkDelivery.sourceBackedSatelliteBatches)) {
      expect(bodyIds).toHaveLength(expectedBatchLengths[parent as keyof typeof expectedBatchLengths])
      for (const bodyId of bodyIds) {
        const body = ephemerisById.get(bodyId)
        expect(body?.parentId).toBe(parent)
        expect(fullTargetStrings.has(String(body?.naifId))).toBe(true)
        sourceBackedIds.add(bodyId)
      }
    }
    expect(ephemerisBodies.bodies.filter((body) => body.kind === 'moon').map((body) => body.id).sort()).toEqual([...sourceBackedIds].sort())
    const fullPrimaryTargets = new Set(ephemerisManifestFull.files.flatMap((file) => file.targets ?? []))
    for (const primary of satelliteCatalog.primaries) {
      const body = majorBodiesById.get(primary.id)
      expect(body, primary.id).toMatchObject({ id: primary.id, naifId: primary.naifId, source: 'jpl-satellite-inventory' })
      expect(body?.orbit, primary.id).toBeUndefined()
      expect(fullPrimaryTargets.has(primary.naifId), primary.id).toBe(true)
    }
  })
})
