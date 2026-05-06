import type { CelestialBody } from '../types'

// Pre-computed approximate trajectories for famous spacecraft
// Positions are heliocentric, stored as [julianDayOffset, x, y, z] relative to J2000
// Julian day offsets from J2000 (2451545)

type SpacecraftDef = CelestialBody & {
  trajectoryPoints: { jd: number; x: number; y: number; z: number }[]
}

const J2000 = 2451545

function jd(dayOffset: number) {
  return J2000 + dayOffset
}

export const SPACECRAFT: SpacecraftDef[] = [
  {
    id: 'voyager1',
    name: '旅行者 1 号',
    shortName: 'Voyager 1',
    kind: 'asteroid',
    color: '#ffcc00',
    size: 3.5,
    source: 'jpl-sbdb',
    isCatalogBody: true,
    trajectoryPoints: [
      { jd: jd(0), x: 0, y: 0, z: 0 },
      { jd: jd(365), x: 0.8, y: 0.5, z: 0.05 },
      { jd: jd(730), x: 1.8, y: 1.2, z: 0.1 },
      { jd: jd(1095), x: 3.2, y: 2.1, z: 0.15 },
      { jd: jd(1825), x: 5.5, y: 3.5, z: 0.2 },
      { jd: jd(3650), x: 12, y: 8, z: 0.5 },
      { jd: jd(7300), x: 28, y: 18, z: 1.2 },
      { jd: jd(10950), x: 48, y: 30, z: 2.0 },
      { jd: jd(14600), x: 72, y: 44, z: 3.0 },
      { jd: jd(18250), x: 100, y: 60, z: 4.2 },
    ],
  },
  {
    id: 'voyager2',
    name: '旅行者 2 号',
    shortName: 'Voyager 2',
    kind: 'asteroid',
    color: '#66ccff',
    size: 3.5,
    source: 'jpl-sbdb',
    isCatalogBody: true,
    trajectoryPoints: [
      { jd: jd(0), x: 0, y: 0, z: 0 },
      { jd: jd(365), x: 0.7, y: -0.4, z: -0.02 },
      { jd: jd(730), x: 1.5, y: -1.0, z: -0.05 },
      { jd: jd(1095), x: 2.8, y: -1.8, z: -0.1 },
      { jd: jd(1825), x: 5.2, y: -3.2, z: -0.2 },
      { jd: jd(3650), x: 11, y: -7.5, z: -0.5 },
      { jd: jd(7300), x: 26, y: -17, z: -1.2 },
      { jd: jd(10950), x: 45, y: -28, z: -2.0 },
      { jd: jd(14600), x: 68, y: -42, z: -3.0 },
      { jd: jd(18250), x: 95, y: -58, z: -4.2 },
    ],
  },
  {
    id: 'newhorizons',
    name: '新视野号',
    shortName: 'New Horizons',
    kind: 'asteroid',
    color: '#88ffcc',
    size: 3.2,
    source: 'jpl-sbdb',
    isCatalogBody: true,
    trajectoryPoints: [
      { jd: jd(500), x: 1.0, y: 0.3, z: 0.01 },
      { jd: jd(800), x: 2.5, y: 1.5, z: 0.02 },
      { jd: jd(1200), x: 5.3, y: 3.2, z: 0.05 },
      { jd: jd(3650), x: 30, y: 18, z: 2.0 },
      { jd: jd(5475), x: 48, y: 30, z: 4.0 },
      { jd: jd(7300), x: 62, y: 38, z: 6.0 },
    ],
  },
]
