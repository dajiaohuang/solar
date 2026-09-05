export type BodyId = string

export type BodyKind = 'star' | 'planet' | 'moon' | 'dwarfPlanet' | 'asteroid' | 'spacecraft'

export type OrbitSource = 'jpl-approx' | 'jpl-satellite-mean' | 'jpl-satellite-inventory' | 'jpl-sbdb' | 'mpcorb' | 'horizons' | 'curated-approx' | 'schematic' | 'custom' | 'jpl-spk-osculating-fallback'

export type SatelliteOrbitEvidence = {
  sourceFrame: 'jpl-ecliptic' | 'undocumented-illustrative'
  appliedFrame: 'scene-j2000-ecliptic'
  sourceCenter: 'earth-geocenter' | 'planet-center' | 'undocumented-parent-center'
  appliedCenter: 'earth-geocenter' | 'parent-rendered-point'
  centerHandling: 'de440-gm-barycentric-partition' | 'direct-parent-addition'
  epochLabel: string
  epochTimeScale: 'TDB' | 'unspecified'
  phaseProvenance: 'jpl-mean-elements' | 'jpl-horizons-osculating-elements' | 'illustrative-zero-at-epoch'
  precision: 'fixed-mean-ellipse-not-ephemeris' | 'fixed-osculating-ellipse-at-epoch-not-ephemeris' | 'illustrative-fixed-ellipse'
  sourceEphemeris?: string
  sourceUrl?: string
  sourceQueryUrl?: string
}

export type DatasetMode = 'lite' | 'full'

export type CatalogSampleProfile = 'desktop' | 'mobile'
export type RenderQuality = 'auto' | 'balanced' | 'max'

export type MagnitudeStatus = 'all' | 'known' | 'unknown'

export type CatalogFilters = {
  query: string
  orbitClass: string
  semiMajorAxis: [number, number]
  eccentricity: [number, number]
  inclination: [number, number]
  absoluteMagnitude: [number, number]
  magnitudeStatus: MagnitudeStatus
  perihelion: [number, number]
}

export type OrbitClassCode =
  | 'MBA'
  | 'TNO'
  | 'APO'
  | 'ATE'
  | 'AMO'
  | 'ATI'
  | 'MCR'
  | 'HIL'
  | 'JTA'
  | 'HUN'
  | 'OTHER'
  | string

export type Vector2 = {
  x: number
  y: number
}

export type Vector3 = {
  x: number
  y: number
  z: number
}

export type ElementSet = {
  semiMajorAxisAU: number
  eccentricity: number
  inclinationDeg: number
  meanLongitudeDeg: number
  longitudeOfPerihelionDeg: number
  longitudeOfAscendingNodeDeg: number
}

export type PlanetaryExtraTerms = {
  b: number
  c: number
  s: number
  f: number
}

export type PlanetaryApproxOrbit = {
  model: 'planetaryApprox'
  base: ElementSet
  rates: ElementSet
  extraTerms?: PlanetaryExtraTerms
}

export type KeplerianOrbit = {
  model: 'keplerian'
  epochJd: number
  epochTimeScale?: 'TDB'
  semiMajorAxisAU: number
  eccentricity: number
  inclinationDeg: number
  ascendingNodeDeg: number
  argPeriapsisDeg: number
  meanAnomalyDeg: number
  meanMotionDegPerDay: number
}

export type OrbitDefinition = PlanetaryApproxOrbit | KeplerianOrbit

export type CelestialBody = {
  id: BodyId
  naifId?: number
  name: string
  shortName?: string
  kind: BodyKind
  color: string
  size: number
  source: OrbitSource
  satelliteOrbitEvidence?: SatelliteOrbitEvidence
  orbitRepresents?: 'earth-moon-barycenter'
  positionRepresents?: 'earth-geocenter'
  parentId?: BodyId
  orbit?: OrbitDefinition
  orbitClassCode?: OrbitClassCode
  orbitClassName?: string
  absoluteMagnitude?: number
  radiusKm?: number
  orbitConditionCode?: string
  dataEpochLabel?: string
  isCatalogBody?: boolean
}

export type BodyPosition = {
  body: CelestialBody
  position: Vector3
}

export type RenderedBodyPosition = {
  body: CelestialBody
  planarPosition: Vector2
  position3D?: Vector3
  distance: number
}

export type TrajectorySample = {
  body: CelestialBody
  points: Vector2[]
  points3D?: Vector3[]
}

export type TrajectoryFrameData = {
  currentPositions: import('./lib/currentPositions').CurrentPositions
  trajectories: TrajectorySample[]
  /** Bodies omitted because at least one historical sample had no state. */
  trajectoryUnavailableBodyIds: BodyId[]
  maxDistance: number
}

export type TrajectoryWorkerRequest = {
  type: 'compute'
  ephemerisFiles?: string[]
  requestId: number
  bodies: CelestialBody[]
  resolutionBodies: CelestialBody[]
  referenceId: BodyId
  centerJulianDay: number
  historyDays: number
  sampleCount: number
}

export type TrajectoryWorkerCancelRequest = {
  type: 'cancel'
  requestId: number
}

export type PackedTrajectoryData = {
  bodyIds: BodyId[]
  trajectoryUnavailableBodyIds: BodyId[]
  offsets: Uint32Array
  points2D: Float64Array
  points3D: Float64Array
}

export type TrajectoryWorkerResponse = {
  type: 'result' | 'progress' | 'cancelled' | 'error'
  requestId: number
  packed?: PackedTrajectoryData
  progress?: number
  error?: string
}

export type CatalogPointWorkerRequest = {
  type: 'compute'
  requestId: number
  julianDay: number
  elements: Float64Array
}

export type CatalogPointWorkerResponse = {
  type: 'progress' | 'result' | 'error'
  requestId: number
  progress?: number
  positions?: Float32Array
  positions3D?: Float32Array
  error?: string
}

export type AsteroidIndexEntry = {
  id: BodyId
  packedDesignation?: string
  permanentNumber?: number
  label: string
  shortLabel: string
  searchKey: string
  chunkId: string
  chunkIndex?: number
  rowIndex?: number
  orbitClassCode: OrbitClassCode
  orbitClassName: string
  absoluteMagnitude?: number
  isNeo: boolean
  isPha: boolean
}

export type CatalogLocator = {
  chunkIndex: number
  rowIndex: number
}

export type AsteroidRecord = AsteroidIndexEntry & {
  epochJd: number
  semiMajorAxisAU: number
  eccentricity: number
  inclinationDeg: number
  ascendingNodeDeg: number
  argPeriapsisDeg: number
  meanAnomalyDeg: number
  meanMotionDegPerDay: number
}

export type AsteroidSectionCursor = {
  chunkIndex: number
  recordOffset: number
}

export type AsteroidManifest = {
  schemaVersion?: number
  version: string
  datasetMode?: DatasetMode
  source: string
  generatedAt: string
  sourceLastModifiedAt?: string
  sourceDownloadedAt?: string
  sourceSha256?: string
  contentSha256?: string
  parserVersion?: string
  parserCommit?: string
  capabilities?: string[]
  selectionPolicy?: DatasetSelectionPolicy
  orbitModel?: string
  precision?: string
  totalCount: number
  chunkCount: number
  chunkSize: number
  format?: 'json-v1' | 'binary-v1'
  compactIndex?: {
    path: string
    format: 'catalog-index-v1'
    strideBytes: number
    count: number
    classCodes: string[]
  }
  precomputedSamples?: {
    desktop?: CatalogSampleArtifact
    mobile?: CatalogSampleArtifact
  }
  summaryPath?: string
  searchIndex?: {
    permanentNumberBucketSize: number
    provisionalYearBuckets: boolean
    tokenInitialBuckets: boolean
    tokenPrefixLength?: number
    locators?: boolean
  }
  releasePath?: string
  lookupBucketCount?: number
  bucketCounts: Record<string, number>
  categoryCounts: Record<string, number>
  featured: AsteroidIndexEntry[]
}

export type CatalogSummary = {
  schemaVersion: number
  datasetMode: DatasetMode
  totalCount: number
  categoryCounts: Record<string, number>
  magnitudeKnownCount?: number
  magnitudeUnknownCount?: number
  numericRanges: Record<string, [number, number]>
  sourceSha256: string
}

export type CatalogSampleArtifact = {
  metadataPath: string
  binaryPath: string
  count: number
}

export type CatalogScanWorkerRequest = {
  type: 'scan'
  requestId: number
  scanKey: string
  manifest: AsteroidManifest
  filters: CatalogFilters
  sampleLimit: number
  candidateLocators?: Uint32Array
}

export type CatalogScanWorkerCancelRequest = {
  type: 'cancel'
  requestId: number
}

export type CatalogScanWorkerResponse = {
  type: 'progress' | 'result' | 'error'
  requestId: number
  scanKey: string
  progress?: number
  total?: number
  records?: AsteroidRecord[]
  locators?: Uint32Array
  error?: string
}

export type DatasetVersion = {
  schemaVersion: number
  activeVersion: string
  mode: DatasetMode
  manifestPath: string
  generatedAt: string
  sourceLastModifiedAt?: string
  sourceSha256: string
  contentSha256?: string
  selectionPolicy?: DatasetSelectionPolicy
}

export type DatasetSelectionPolicy = {
  type: 'all-valid-elliptic' | 'permanent-number-through-plus-featured'
  maxPermanentNumber?: number
  requiredFeaturedNames: string[]
}

export type DatasetProvenance = {
  datasetVersion: string
  source: string
  downloadedAt?: string
  generatedAt: string
  sourceLastModifiedAt?: string
  sourceSha256: string
  contentSha256?: string
  parserVersion: string
  parserCommit?: string
  selectionPolicy?: DatasetSelectionPolicy
  totalObjects: number
  mode: DatasetMode
  orbitModel: string
  precision: string
}
