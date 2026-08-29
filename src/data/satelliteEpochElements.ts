import type { KeplerianOrbit, SatelliteOrbitEvidence } from '../types'

const J2000 = 2451545

export const JPL_HORIZONS_API_URL = 'https://ssd-api.jpl.nasa.gov/doc/horizons.html'

type GiantSatelliteId = 'io' | 'europa' | 'ganymede' | 'callisto' | 'titan'

type HorizonsEpochElements = Omit<KeplerianOrbit, 'model' | 'epochJd'> & {
  targetCode: '501' | '502' | '503' | '504' | '606'
  sourceEphemeris: 'jup365_merged' | 'sat441l'
  centerCode: '500@599' | '500@699'
}

/**
 * NASA/JPL Horizons geometric osculating elements at JD 2451545.0 TDB.
 * Query contract: EPHEM_TYPE=ELEMENTS, REF_PLANE=ECLIPTIC, REF_SYSTEM=ICRF,
 * OUT_UNITS=AU-D, with the parent planet's body center as CENTER.
 */
export const JPL_HORIZONS_GIANT_SATELLITE_ELEMENTS: Record<GiantSatelliteId, HorizonsEpochElements> = {
  io: {
    targetCode: '501', sourceEphemeris: 'jup365_merged', centerCode: '500@599',
    semiMajorAxisAU: 0.002821139295029148, eccentricity: 0.004715688921345897,
    inclinationDeg: 2.212617763556377, ascendingNodeDeg: 336.8524452085695,
    argPeriapsisDeg: 66.16488500283468, meanAnomalyDeg: 335.153206478952,
    meanMotionDegPerDay: 203.2295710817172,
  },
  europa: {
    targetCode: '502', sourceEphemeris: 'jup365_merged', centerCode: '500@599',
    semiMajorAxisAU: 0.004487019063502094, eccentricity: 0.009812823575576082,
    inclinationDeg: 1.790971209716447, ascendingNodeDeg: 332.6287323572119,
    argPeriapsisDeg: 254.6471423731226, meanAnomalyDeg: 345.411036769848,
    meanMotionDegPerDay: 101.3169477820738,
  },
  ganymede: {
    targetCode: '503', sourceEphemeris: 'jup365_merged', centerCode: '500@599',
    semiMajorAxisAU: 0.007155833676042577, eccentricity: 0.001457215292672099,
    inclinationDeg: 2.214148041848081, ascendingNodeDeg: 343.1728455275238,
    argPeriapsisDeg: 319.8078127226449, meanAnomalyDeg: 277.0487684461206,
    meanMotionDegPerDay: 50.30834975743021,
  },
  callisto: {
    targetCode: '504', sourceEphemeris: 'jup365_merged', centerCode: '500@599',
    semiMajorAxisAU: 0.01258555984162885, eccentricity: 0.007439434600948234,
    inclinationDeg: 2.016916220859312, ascendingNodeDeg: 337.9426103461244,
    argPeriapsisDeg: 16.12689497888475, meanAnomalyDeg: 85.11888858079212,
    meanMotionDegPerDay: 21.5683527268963,
  },
  titan: {
    targetCode: '606', sourceEphemeris: 'sat441l', centerCode: '500@699',
    semiMajorAxisAU: 0.00816812963443584, eccentricity: 0.02860066256432539,
    inclinationDeg: 27.71833887311165, ascendingNodeDeg: 169.2391602866279,
    argPeriapsisDeg: 164.4091285733822, meanAnomalyDeg: 163.4361974944248,
    meanMotionDegPerDay: 22.57428702984641,
  },
}

export function jplHorizonsEpochQueryUrl(bodyId: GiantSatelliteId) {
  const { targetCode, centerCode } = JPL_HORIZONS_GIANT_SATELLITE_ELEMENTS[bodyId]
  const query = new URLSearchParams({
    format: 'text',
    COMMAND: `'${targetCode}'`,
    OBJ_DATA: `'NO'`,
    MAKE_EPHEM: `'YES'`,
    EPHEM_TYPE: `'ELEMENTS'`,
    CENTER: `'${centerCode}'`,
    START_TIME: `'JD2451545.0'`,
    STOP_TIME: `'JD2451545.1'`,
    STEP_SIZE: `'1d'`,
    REF_PLANE: `'ECLIPTIC'`,
    REF_SYSTEM: `'ICRF'`,
    OUT_UNITS: `'AU-D'`,
    CSV_FORMAT: `'YES'`,
  })
  return `https://ssd.jpl.nasa.gov/api/horizons.api?${query}`
}

export function jplHorizonsGiantSatelliteOrbit(bodyId: GiantSatelliteId): KeplerianOrbit {
  const elements = JPL_HORIZONS_GIANT_SATELLITE_ELEMENTS[bodyId]
  return {
    model: 'keplerian',
    epochJd: J2000,
    semiMajorAxisAU: elements.semiMajorAxisAU,
    eccentricity: elements.eccentricity,
    inclinationDeg: elements.inclinationDeg,
    ascendingNodeDeg: elements.ascendingNodeDeg,
    argPeriapsisDeg: elements.argPeriapsisDeg,
    meanAnomalyDeg: elements.meanAnomalyDeg,
    meanMotionDegPerDay: elements.meanMotionDegPerDay,
  }
}

export function jplHorizonsGiantSatelliteEvidence(bodyId: GiantSatelliteId): SatelliteOrbitEvidence {
  return {
    sourceFrame: 'jpl-ecliptic',
    appliedFrame: 'scene-j2000-ecliptic',
    sourceCenter: 'planet-center',
    appliedCenter: 'parent-rendered-point',
    centerHandling: 'direct-parent-addition',
    epochLabel: 'JD 2451545.0',
    epochTimeScale: 'TDB',
    phaseProvenance: 'jpl-horizons-osculating-elements',
    precision: 'fixed-osculating-ellipse-at-epoch-not-ephemeris',
    sourceEphemeris: JPL_HORIZONS_GIANT_SATELLITE_ELEMENTS[bodyId].sourceEphemeris,
    sourceUrl: JPL_HORIZONS_API_URL,
    sourceQueryUrl: jplHorizonsEpochQueryUrl(bodyId),
  }
}
