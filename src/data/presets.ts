import { dateToJulianDay } from '../lib/julianDate'
import type { BodyId } from '../types'

export type ScenePreset = {
  id: string
  name: string
  description: string
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
    name: '今天',
    description: '以当前日期查看内太阳系',
    referenceId: 'sun',
    julianDay: dateToJulianDay(new Date()),
    selectedMajorBodyIds: ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'ceres', 'pluto'],
    zoomLevel: 1,
    historyDays: 365,
  },
  {
    id: 'inner-system',
    name: '内太阳系',
    description: '内行星 + 主带矮行星，180 天轨迹',
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['mercury', 'venus', 'earth', 'moon', 'mars'],
    zoomLevel: 1.4,
    historyDays: 180,
  },
  {
    id: 'outer-system',
    name: '外太阳系',
    description: '外行星 + 矮行星，12 年轨迹',
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['jupiter', 'saturn', 'uranus', 'neptune'],
    zoomLevel: 0.4,
    historyDays: 365 * 12,
  },
  {
    id: 'dwarf-orbits',
    name: '矮行星轨道',
    description: '五大矮行星，33 年完整轨道',
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['ceres', 'pluto', 'eris', 'haumea', 'makemake'],
    zoomLevel: 0.4,
    historyDays: 365 * 33,
  },
  {
    id: 'mars-opposition',
    name: '火星冲日 2027',
    description: '2027 年 2 月火星冲日前后，日心视角',
    referenceId: 'sun',
    julianDay: dateToJD('2027-02-19'),
    selectedMajorBodyIds: ['earth', 'mars', 'jupiter'],
    zoomLevel: 1.6,
    historyDays: 180,
  },
  {
    id: 'jupiter-io',
    name: '木星系',
    description: '木星及其轨道，5 年轨迹',
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['jupiter'],
    zoomLevel: 1.2,
    historyDays: 365 * 5,
  },
  {
    id: 'neo-overview',
    name: '近地天体区域',
    description: '内太阳系近地天体活跃区，适合加载 NEO 小行星后观察',
    referenceId: 'sun',
    julianDay: dateToJD('2026-07-01'),
    selectedMajorBodyIds: ['earth', 'mars', 'venus'],
    zoomLevel: 1.8,
    historyDays: 365,
  },
  {
    id: 'voyager-era',
    name: '旅行者号时代',
    description: '1977–1989 外行星排列，适合多行星飞掠',
    referenceId: 'sun',
    julianDay: dateToJD('1980-01-01'),
    selectedMajorBodyIds: ['jupiter', 'saturn', 'uranus', 'neptune'],
    zoomLevel: 0.5,
    historyDays: 365 * 12,
  },
]
