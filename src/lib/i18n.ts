import { useState, useCallback } from 'react'

export type Lang = 'zh' | 'en'

const STORAGE_KEY = 'solar-lang'

const dict: Record<string, Record<Lang, string>> = {
  menu: { zh: '菜单', en: 'Menu' },
  overview: { zh: '概览', en: 'Overview' },
  controls: { zh: '控制', en: 'Controls' },
  major: { zh: '主要天体', en: 'Major Bodies' },
  asteroids: { zh: '小行星', en: 'Asteroids' },
  conjunctions: { zh: '交会', en: 'Conjunctions' },
  properties: { zh: '属性', en: 'Properties' },
  custom: { zh: '自定义', en: 'Custom' },
  loaded: { zh: '已载入', en: 'Loaded' },
  reference: { zh: '参考点', en: 'Reference' },
  date: { zh: '日期', en: 'Date' },
  speed: { zh: '倍率', en: 'Speed' },
  showing: { zh: '显示', en: 'Showing' },
  daysPerSec: { zh: '天/秒', en: 'd/s' },
  play: { zh: '暂停', en: 'Pause' },
  resume: { zh: '继续', en: 'Play' },
  backToStart: { zh: '回到起点', en: 'Reset Time' },
  resetZoom: { zh: '重置缩放', en: 'Reset Zoom' },
  view3d: { zh: '3D 视图', en: '3D View' },
  view2d: { zh: '2D 视图', en: '2D View' },
  splitMode: { zh: '对比模式（分屏）', en: 'Split Compare' },
  splitRef: { zh: '对比参考点', en: 'Compare Reference' },
  showOrbits: { zh: '显示完整轨道椭圆', en: 'Show Full Orbits' },
  showLagrange: { zh: '显示拉格朗日点', en: 'Show Lagrange Points' },
  showEcliptic: { zh: '显示黄道面', en: 'Show Ecliptic Plane' },
  measure: { zh: '测量距离', en: 'Measure Distance' },
  measuring: { zh: '测量中…', en: 'Measuring…' },
  screenshot: { zh: '截图 PNG', en: 'Screenshot PNG' },
  exportJSON: { zh: '导出 JSON', en: 'Export JSON' },
  exportCSV: { zh: '导出 CSV', en: 'Export CSV' },
  fullscreen: { zh: '全屏', en: 'Fullscreen' },
  scene: { zh: '场景', en: 'Scene' },
  selectScene: { zh: '选择场景…', en: 'Select scene…' },
  jumpDate: { zh: '跳转日期', en: 'Jump to Date' },
  trajDuration: { zh: '轨迹时长', en: 'Trail Duration' },
  timeSpeed: { zh: '时间倍率', en: 'Time Rate' },
  zoom: { zh: '缩放倍率', en: 'Zoom' },
  innerPlanets: { zh: '内行星', en: 'Inner' },
  outerPlanets: { zh: '外行星', en: 'Outer' },
  dwarfPlanets: { zh: '矮行星', en: 'Dwarfs' },
  allMajor: { zh: '主要天体全选', en: 'All Major' },
  savedGroups: { zh: '自定义组', en: 'Saved Groups' },
  saveCurrent: { zh: '保存当前选择', en: 'Save Current' },
  save: { zh: '保存', en: 'Save' },
  cancel: { zh: '取消', en: 'Cancel' },
  groupName: { zh: '输入组名…', en: 'Group name…' },
  presetHint: { zh: '选择一个预设场景，自动配置参考点、天体、缩放和轨迹时长', en: 'Select a preset to auto-configure reference, bodies, zoom, and duration' },
  currentRef: { zh: '当前参考点', en: 'Current Reference' },
  simTime: { zh: '模拟时间', en: 'Sim Time' },
  currentDate: { zh: '当前日期', en: 'Current Date' },
  maxDistance: { zh: '当前最远距离', en: 'Max Distance' },
  majorBodies: { zh: '主要天体', en: 'Major Bodies' },
  searchAsteroids: { zh: '搜索小行星', en: 'Search Asteroids' },
  orbitClass: { zh: '轨道分类', en: 'Orbit Class' },
  clearLoaded: { zh: '清空已加载小天体', en: 'Clear Loaded' },
  createBody: { zh: '创建自定义天体', en: 'Create Custom Body' },
  createBtn: { zh: '创建天体', en: 'Create Body' },
  name: { zh: '名称', en: 'Name' },
  semiMajorAxis: { zh: '半长轴 (AU)', en: 'Semi-major axis (AU)' },
  eccentricity: { zh: '离心率', en: 'Eccentricity' },
  inclination: { zh: '倾角 (°)', en: 'Inclination (°)' },
  ascendingNode: { zh: '升交点黄经 (°)', en: 'Asc. Node (°)' },
  argPeriapsis: { zh: '近日点幅角 (°)', en: 'Arg. Periapsis (°)' },
  meanAnomaly: { zh: '平近点角 (°)', en: 'Mean Anomaly (°)' },
  color: { zh: '颜色', en: 'Color' },
  selectBody: { zh: '选择天体', en: 'Select Body' },
  bodyType: { zh: '类型', en: 'Type' },
  orbits: { zh: '环绕', en: 'Orbits' },
  orbitalPeriod: { zh: '轨道周期', en: 'Orbital Period' },
  absMagnitude: { zh: '绝对星等', en: 'Abs. Magnitude' },
  orbitClassLabel: { zh: '轨道分类', en: 'Orbit Class' },
  dataSource: { zh: '数据来源', en: 'Data Source' },
  measuringSelect: { zh: '双击天体选择', en: 'Double-click body to select' },
  measuringSecond: { zh: '双击第二个天体', en: 'Double-click second body' },
  star: { zh: '恒星', en: 'Star' },
  planet: { zh: '行星', en: 'Planet' },
  moon: { zh: '卫星', en: 'Moon' },
  dwarf: { zh: '矮行星', en: 'Dwarf Planet' },
  asteroid: { zh: '小行星', en: 'Asteroid' },
  fullscreenHint: { zh: '全屏显示。左侧抽屉可切换概览、控制、主要天体、小行星等板块。', en: 'Fullscreen view. Left drawer for overview, controls, bodies, asteroids, etc.' },
  measuringLabel: { zh: '测量', en: 'Measure' },
  clickToggleDate: { zh: '点击切换日期/儒略日', en: 'Click to toggle Date/Julian Day' },
  dblClickChangeRef: { zh: '双击切换参考点', en: 'Double-click to change reference' },
  creatingCustomBody: { zh: '输入开普勒轨道根数创建一个虚拟天体并加入视图。创建后可在天体列表中选中等操作。', en: 'Enter Keplerian orbital elements to create a virtual body. It will appear in the body list for selection.' },
  createdCount: { zh: '已创建', en: 'Created' },
  customBodies: { zh: '个自定义天体', en: ' custom bodies' },
  neoDistance: { zh: 'NEO 距离', en: 'NEO Distance' },
  totalAsteroids: { zh: '个', en: '' },
  notGenerated: { zh: '未生成', en: 'Not generated' },
  conjunctionDesc: { zh: '检测当前显示天体两两之间的最近距离，结果按距离升序排列。', en: 'Find closest approaches between displayed bodies, sorted by distance.' },
  conjunctionThreshold: { zh: '距离阈值 (AU)', en: 'Distance Threshold (AU)' },
  conjunctionWindow: { zh: '搜索窗口 (天)', en: 'Search Window (days)' },
  computing: { zh: '正在计算交会事件…', en: 'Computing conjunctions…' },
  foundEvents: { zh: '找到', en: 'Found' },
  conjunctionEvents: { zh: '个交会事件', en: ' conjunction events' },
  noEvents: { zh: '未找到交会事件', en: 'No conjunction events found' },
  needTwoBodies: { zh: '需要至少选择 2 个天体才能检测交会。', en: 'Need at least 2 bodies selected.' },
  distanceAU: { zh: '距离', en: 'Distance' },
}

const cache = new Map<string, string>()

export function getLang(): Lang {
  try {
    return (localStorage.getItem(STORAGE_KEY) as Lang) ?? 'zh'
  } catch {
    return 'zh'
  }
}

export function t(key: string): string {
  const lang = getLang()
  const entry = dict[key]
  if (!entry) {
    return key
  }

  return entry[lang] ?? key
}

export function useLanguage() {
  const [lang, setLangState] = useState<Lang>(getLang)

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l)
    cache.clear()
    setLangState(l)
  }, [])

  const toggle = useCallback(() => {
    setLang(lang === 'zh' ? 'en' : 'zh')
  }, [lang, setLang])

  return { lang, setLang, toggle, t }
}
