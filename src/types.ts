export type BodyId = string

export type BodyKind = 'star' | 'planet' | 'moon' | 'dwarfPlanet' | 'asteroid'

export type OrbitSource = 'jpl-approx' | 'jpl-sbdb' | 'mpcorb'

export type OrbitClassCode =
  | 'MBA'
  | 'TNO'
  | 'APO'
  | 'ATE'
  | 'AMO'
  | 'ATI'
  | 'HIL'
  | 'JTA'
  | 'HUN'
  | 'other'
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
  name: string
  shortName?: string
  kind: BodyKind
  color: string
  size: number
  source: OrbitSource
  parentId?: BodyId
  orbit?: OrbitDefinition
  orbitClassCode?: OrbitClassCode
  orbitClassName?: string
  absoluteMagnitude?: number
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
  currentPositions: RenderedBodyPosition[]
  trajectories: TrajectorySample[]
  maxDistance: number
}

export type TrajectoryWorkerRequest = {
  type: 'compute'
  requestId: number
  bodies: CelestialBody[]
  resolutionBodies: CelestialBody[]
  referenceId: BodyId
  centerJulianDay: number
  historyDays: number
  sampleCount: number
}

export type TrajectoryWorkerResponse = {
  type: 'result'
  requestId: number
  frame: TrajectoryFrameData
}

export type AsteroidIndexEntry = {
  id: BodyId
  label: string
  shortLabel: string
  searchKey: string
  chunkId: string
  orbitClassCode: OrbitClassCode
  orbitClassName: string
  absoluteMagnitude?: number
  isNeo: boolean
  isPha: boolean
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
  version: string
  source: string
  generatedAt: string
  totalCount: number
  chunkCount: number
  chunkSize: number
  bucketCounts: Record<string, number>
  categoryCounts: Record<string, number>
  featured: AsteroidIndexEntry[]
}
