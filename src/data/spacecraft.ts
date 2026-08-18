import type { CelestialBody } from '../types'

/**
 * Deliberately schematic heliocentric paths for storytelling. Dates track real
 * mission milestones, while coordinates only preserve broad encounter distance
 * and outbound direction. These points must never be presented as Horizons or
 * navigation ephemerides.
 */
export type SpacecraftDef = CelestialBody & {
  trajectoryPoints: { jd: number; x: number; y: number; z: number }[]
}

function jd(isoDate: string) {
  return Date.parse(`${isoDate}T12:00:00Z`) / 86_400_000 + 2_440_587.5
}

export const SPACECRAFT: SpacecraftDef[] = [
  {
    id: 'voyager1',
    name: '旅行者 1 号',
    shortName: 'Voyager 1',
    kind: 'spacecraft',
    color: '#ffcc00',
    size: 3.5,
    source: 'schematic',
    dataEpochLabel: 'Milestone-dated teaching path; coordinates are schematic',
    isCatalogBody: true,
    trajectoryPoints: [
      { jd: jd('1977-09-05'), x: 0.85, y: -0.55, z: 0 },
      { jd: jd('1979-03-05'), x: 4.6, y: 2.3, z: 0.15 },
      { jd: jd('1980-11-12'), x: 7.8, y: 5.4, z: 0.35 },
      { jd: jd('1990-01-01'), x: 25, y: 18, z: 1.4 },
      { jd: jd('2000-01-01'), x: 50, y: 37, z: 3 },
      { jd: jd('2010-01-01'), x: 79, y: 58, z: 5 },
      { jd: jd('2025-01-01'), x: 134, y: 98, z: 8 },
    ],
  },
  {
    id: 'voyager2',
    name: '旅行者 2 号',
    shortName: 'Voyager 2',
    kind: 'spacecraft',
    color: '#66ccff',
    size: 3.5,
    source: 'schematic',
    dataEpochLabel: 'Milestone-dated teaching path; coordinates are schematic',
    isCatalogBody: true,
    trajectoryPoints: [
      { jd: jd('1977-08-20'), x: 0.75, y: -0.65, z: 0 },
      { jd: jd('1979-07-09'), x: 4.8, y: -2, z: -0.12 },
      { jd: jd('1981-08-25'), x: 8.3, y: -4.6, z: -0.3 },
      { jd: jd('1986-01-24'), x: 15, y: -11.5, z: -0.8 },
      { jd: jd('1989-08-25'), x: 22, y: -20, z: -1.6 },
      { jd: jd('2000-01-01'), x: 39, y: -37, z: -3 },
      { jd: jd('2025-01-01'), x: 100, y: -92, z: -8 },
    ],
  },
  {
    id: 'newhorizons',
    name: '新视野号',
    shortName: 'New Horizons',
    kind: 'spacecraft',
    color: '#88ffcc',
    size: 3.2,
    source: 'schematic',
    dataEpochLabel: 'Milestone-dated teaching path; coordinates are schematic',
    isCatalogBody: true,
    trajectoryPoints: [
      { jd: jd('2006-01-19'), x: 0.85, y: 0.5, z: 0 },
      { jd: jd('2007-02-28'), x: 4.6, y: 2.4, z: 0.08 },
      { jd: jd('2015-07-14'), x: 24, y: 22.5, z: 2.2 },
      { jd: jd('2019-01-01'), x: 32, y: 29, z: 3.2 },
      { jd: jd('2025-01-01'), x: 45, y: 40, z: 4.6 },
    ],
  },
]
