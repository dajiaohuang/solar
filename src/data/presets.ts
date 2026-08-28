import { dateToJulianDay } from '../lib/julianDate'
import type { BodyId } from '../types'

export type ScenePreset = {
  id: string
  name: { en: string; zh: string }
  description: { en: string; zh: string }
  referenceId: BodyId
  julianDay: number
  selectedMajorBodyIds: BodyId[]
  zoomLevel: number
  historyDays: number
}

function dateToJD(dateString: string) {
  return dateToJulianDay(new Date(dateString))
}

export const SCENE_PRESETS: ScenePreset[] = [
  {
    id: 'today',
    name: { en: 'Solar System today', zh: '今日太阳系' },
    description: { en: 'The major bodies at the current epoch.', zh: '以当前历元查看太阳系主要天体。' },
    referenceId: 'sun',
    julianDay: dateToJulianDay(new Date()),
    selectedMajorBodyIds: ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'ceres', 'pluto'],
    zoomLevel: 1,
    historyDays: 365,
  },
  {
    id: 'inner-system',
    name: { en: 'Inner Solar System', zh: '内太阳系' },
    description: { en: 'Inner planets across a 180-day trajectory window.', zh: '内行星与 180 天轨迹时间窗。' },
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['mercury', 'venus', 'earth', 'moon', 'mars'],
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
    zoomLevel: 1.6,
    historyDays: 180,
  },
  {
    id: 'jupiter-io',
    name: { en: 'Jupiter system', zh: '木星系统' },
    description: { en: 'Jupiter across a five-year trajectory window.', zh: '木星与 5 年轨迹时间窗。' },
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['jupiter'],
    zoomLevel: 1.2,
    historyDays: 365 * 5,
  },
  {
    id: 'neo-overview',
    name: { en: 'Near-Earth region', zh: '近地天体区域' },
    description: { en: 'An inner-system frame ready for loaded NEOs.', zh: '适合加入并观察 NEO 的内太阳系场景。' },
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['earth', 'mars', 'venus'],
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
    zoomLevel: 0.5,
    historyDays: 365 * 12,
  },
]
