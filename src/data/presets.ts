import { dateToJulianDay } from '../lib/julianDate'
import { majorBodies } from './majorBodies'
import { getOrbitalPeriodDays } from '../lib/orbitalPeriod'
import datasetPin from '../../.github/asteroid-dataset.json'
import type { AppRoute, ElementPlotMode } from '../state/ui-store'
import type { BodyId, CatalogFilters, CatalogSampleProfile, DatasetMode } from '../types'

export type ScenePresetCatalogSelection = {
  datasetVersion: string
  datasetMode: DatasetMode
  sampleProfile: CatalogSampleProfile
  sampleCount: number
  sampleKind: 'display'
  filters: CatalogFilters
}

export type ScenePreset = {
  id: string
  name: { en: string; zh: string }
  description: { en: string; zh: string }
  referenceId: BodyId
  julianDay: number
  selectedMajorBodyIds: BodyId[]
  viewMode: '2d' | '3d'
  zoomLevel: number
  historyDays: number
  route?: AppRoute
  elementPlot?: ElementPlotMode
  catalogSelection?: ScenePresetCatalogSelection
}

export const PRESET_DATASET_RELEASES: Record<string, {
  datasetMode: DatasetMode
  samples: Record<CatalogSampleProfile, number>
}> = {
  [datasetPin.version]: {
    datasetMode: 'full',
    samples: { desktop: 30_000, mobile: 8_000 },
  },
}

const BELT_RELEASE = PRESET_DATASET_RELEASES[datasetPin.version]

const PINNED_BELT_SAMPLE = {
  datasetVersion: datasetPin.version,
  datasetMode: BELT_RELEASE.datasetMode,
  sampleProfile: 'mobile' as const,
  sampleCount: BELT_RELEASE.samples.mobile,
  sampleKind: 'display' as const,
  filters: {
    query: '',
    orbitClass: 'MBA',
    semiMajorAxis: [0, 80] as [number, number],
    eccentricity: [0, 0.999] as [number, number],
    inclination: [0, 180] as [number, number],
    absoluteMagnitude: [-5, 40] as [number, number],
    magnitudeStatus: 'all' as const,
    perihelion: [0, 80] as [number, number],
  },
}

function dateToJD(dateString: string) {
  return dateToJulianDay(new Date(dateString))
}

export const SCENE_PRESETS: ScenePreset[] = [
  ...(['mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const).flatMap((parent): ScenePreset[] => {
    const names = { mars: ['Mars', '火星'], jupiter: ['Jupiter', '木星'], saturn: ['Saturn', '土星'], uranus: ['Uranus', '天王星'], neptune: ['Neptune', '海王星'], pluto: ['Pluto', '冥王星'] }
    const moons = majorBodies.filter((body) => body.kind === 'moon' && body.parentId === parent)
    // At the default 180 samples, keep at least ~30 samples per fastest
    // revolution. Long-period moons may show only part of their trajectory.
    // Seed periods size the display window, not the physical propagation.
    const historyDays = Math.max(1, Math.floor(Math.min(30, ...moons.map((moon) =>
      moon.orbit ? getOrbitalPeriodDays(moon.orbit, 'parent') * 6 : 30,
    ))))
    // Keep every catalog identity reachable, including missing-state entries,
    // without silently truncating a system at the 160-body 3D focus limit.
    const perGroup = 159
    return Array.from({ length: Math.ceil(moons.length / perGroup) }, (_, group): ScenePreset => {
      const first = group * perGroup, selected = moons.slice(first, first + perGroup)
      const range = moons.length > perGroup ? ` · ${first + 1}–${first + selected.length}/${moons.length}` : ''
      return {
        id: `${parent}-spk-moons${group ? `-${group + 1}` : ''}`,
        name: { en: `${names[parent][0]} · ${selected.length} cataloged moons${range}`, zh: `${names[parent][1]} · ${selected.length} 颗目录卫星${range}` },
        description: { en: 'All identities in this group are selected, not necessarily positioned. Loaded SPK is used within coverage; only bodies with an existing seed model can fall back. Missing states are omitted and reported. Short trails may show partial orbits.', zh: '选择本组全部目录身份，不表示全部已有位置。覆盖期内使用已加载 SPK；仅原有种子模型允许回退。缺失状态会标明并省略，短时轨迹可能不满一圈。' },
        referenceId: parent, selectedMajorBodyIds: [parent, ...selected.map((moon) => moon.id)],
        julianDay: dateToJD('2026-09-04'), viewMode: '3d', zoomLevel: 1, historyDays,
      }
    })
  }),
  {
    id: 'large-asteroid-ephemerides', name: { en: '16 large asteroids · JPL SPK', zh: '16 颗大型小行星 · JPL SPK' },
    description: { en: 'Selected DE441 companion asteroid solutions between Mars and Jupiter; not the complete belt.', zh: '火星与木星之间的 DE441 配套小行星解；并非完整小行星带。' },
    referenceId: 'sun', selectedMajorBodyIds: ['mars', 'jupiter', 'ceres', ...majorBodies.filter((body) => body.source === 'jpl-spk-osculating-fallback' && body.kind === 'asteroid').map((body) => body.id)],
    julianDay: dateToJD('2026-09-04'), viewMode: '3d', zoomLevel: 1, historyDays: 365,
  },
  {
    id: 'today',
    name: { en: 'Solar System today', zh: '今日太阳系' },
    description: { en: 'The major bodies at the current epoch.', zh: '以当前历元查看太阳系主要天体。' },
    referenceId: 'sun',
    julianDay: dateToJulianDay(new Date()),
    selectedMajorBodyIds: ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'ceres', 'pluto'],
    viewMode: '3d',
    zoomLevel: 1,
    historyDays: 365,
  },
  {
    id: 'earth-moon',
    name: { en: 'Earth–Moon system', zh: '地月系统' },
    description: { en: 'Earth and its modeled moon in an Earth-centered frame.', zh: '在地心参考系中查看地球及其已建模卫星月球。' },
    referenceId: 'earth',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['earth', 'moon'],
    viewMode: '3d',
    zoomLevel: 1,
    historyDays: 30,
  },
  {
    id: 'inner-system',
    name: { en: 'Inner Solar System', zh: '内太阳系' },
    description: { en: 'Inner planets across a 180-day trajectory window.', zh: '内行星与 180 天轨迹时间窗。' },
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['mercury', 'venus', 'earth', 'moon', 'mars'],
    viewMode: '3d',
    zoomLevel: 1.4,
    historyDays: 180,
  },
  {
    id: 'outer-system',
    name: { en: 'Outer Solar System', zh: '外太阳系' },
    description: { en: 'The giant planets across a twelve-year window.', zh: '外行星与 12 年轨迹时间窗。' },
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['jupiter', 'saturn', 'uranus', 'neptune'],
    viewMode: '3d',
    zoomLevel: 0.4,
    historyDays: 365 * 12,
  },
  {
    id: 'dwarf-orbits',
    name: { en: 'Dwarf-planet orbits', zh: '矮行星轨道' },
    description: { en: 'Five dwarf planets across a 33-year window.', zh: '五颗矮行星与 33 年轨迹时间窗。' },
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['ceres', 'pluto', 'eris', 'haumea', 'makemake'],
    viewMode: '3d',
    zoomLevel: 0.4,
    historyDays: 365 * 33,
  },
  {
    id: 'mars-opposition',
    name: { en: 'Mars opposition 2027', zh: '火星冲日 2027' },
    description: { en: 'The February 2027 opposition in a heliocentric frame.', zh: '日心参考系中的 2027 年 2 月火星冲日。' },
    referenceId: 'sun',
    julianDay: dateToJD('2027-02-19'),
    selectedMajorBodyIds: ['earth', 'mars', 'jupiter'],
    viewMode: '3d',
    zoomLevel: 1.6,
    historyDays: 180,
  },
  {
    id: 'jupiter-galilean-moons',
    name: { en: 'Jupiter and its modeled Galilean moons', zh: '木星与已建模伽利略卫星' },
    description: { en: 'Jupiter and all four modeled Galilean moons in a Jupiter-centered frame.', zh: '在木星中心参考系中查看木星及全部四颗已建模伽利略卫星。' },
    referenceId: 'jupiter',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['jupiter', 'io', 'europa', 'ganymede', 'callisto'],
    viewMode: '3d',
    zoomLevel: 1,
    historyDays: 20,
  },
  {
    id: 'saturn-titan',
    name: { en: 'Saturn–Titan system', zh: '土星—泰坦系统' },
    description: { en: 'Saturn and its modeled moon Titan in a Saturn-centered frame.', zh: '在土星中心参考系中查看土星及其已建模卫星泰坦。' },
    referenceId: 'saturn',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['saturn', 'titan'],
    viewMode: '3d',
    zoomLevel: 1,
    historyDays: 32,
  },
  {
    id: 'mars-main-belt-jupiter',
    name: { en: 'Mars–main belt–Jupiter', zh: '火星—主带—木星' },
    description: { en: 'Compare the MBA subset of a pinned 8,000-object display sample in a–e space, with Mars, Ceres and Jupiter retained as heliocentric landmarks.', zh: '在 a–e 空间比较固定 8,000 条展示样本中的主带小行星子集，并保留火星、谷神星和木星作为日心地标。' },
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['mars', 'ceres', 'jupiter'],
    viewMode: '3d',
    zoomLevel: 1,
    historyDays: 365 * 5,
    route: 'elements',
    elementPlot: 'a-e',
    catalogSelection: PINNED_BELT_SAMPLE,
  },
  {
    id: 'main-belt-elements',
    name: { en: 'Main-belt element comparison', zh: '主带轨道元素对比' },
    description: { en: 'Compare semi-major axis and inclination for the MBA subset of the same pinned 8,000-object display sample; not the complete belt.', zh: '比较同一固定 8,000 条展示样本中主带小行星子集的半长轴与倾角；并非完整小行星带。' },
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['mars', 'ceres', 'jupiter'],
    viewMode: '3d',
    zoomLevel: 1,
    historyDays: 365 * 5,
    route: 'elements',
    elementPlot: 'a-i',
    catalogSelection: PINNED_BELT_SAMPLE,
  },
  {
    id: 'neo-overview',
    name: { en: 'Near-Earth region', zh: '近地天体区域' },
    description: { en: 'An inner-system frame ready for loaded NEOs.', zh: '适合加入并观察 NEO 的内太阳系场景。' },
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['earth', 'mars', 'venus'],
    viewMode: '3d',
    zoomLevel: 1.8,
    historyDays: 365,
  },
  {
    id: 'voyager-era',
    name: { en: 'Voyager era', zh: '旅行者号时代' },
    description: { en: 'The outer-planet arrangement of the 1977–1989 flybys.', zh: '1977–1989 年多行星飞掠时期的外行星排列。' },
    referenceId: 'sun',
    julianDay: dateToJD('1980-01-01'),
    selectedMajorBodyIds: ['jupiter', 'saturn', 'uranus', 'neptune'],
    viewMode: '3d',
    zoomLevel: 0.5,
    historyDays: 365 * 12,
  },
]
