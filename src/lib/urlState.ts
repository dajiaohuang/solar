import type { AppRoute, ElementPlotMode } from '../state/ui-store'
import type { BodyId, DatasetMode, MagnitudeStatus } from '../types'

export const SCENE_URL_VERSION = 3 as const
export const LEGACY_SCENE_URL_VERSION = 2 as const
export type ScientificLayer = 'ecliptic' | 'orbits' | 'lagrange' | 'hill' | 'soi' | 'spacecraft'

export type AppUrlState = {
  version?: typeof SCENE_URL_VERSION | typeof LEGACY_SCENE_URL_VERSION
  route?: AppRoute
  dataset?: string
  mode?: DatasetMode
  ref?: BodyId
  compareRef?: BodyId
  compare?: boolean
  bodies?: BodyId[]
  jd?: number
  zoom?: number
  speed?: number
  history?: number
  view?: '2d' | '3d'
  filter?: string
  search?: string
  preset?: string
  story?: string
  step?: number
  guide?: boolean
  missionFrom?: BodyId
  missionTo?: BodyId
  departureDate?: string
  arrivalDate?: string
  focused?: BodyId
  plot?: ElementPlotMode
  aRange?: [number, number]
  eRange?: [number, number]
  iRange?: [number, number]
  hRange?: [number, number]
  hStatus?: MagnitudeStatus
  qRange?: [number, number]
  layers?: ScientificLayer[]
  offset?: [number, number]
  lang?: 'zh' | 'en'
}

function finite(value: string | null) {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseRange(value: string | null): [number, number] | undefined {
  if (!value) return undefined
  const [minimum, maximum, ...extra] = value.split(',').map(Number)
  return !extra.length && Number.isFinite(minimum) && Number.isFinite(maximum) && minimum <= maximum
    ? [minimum, maximum]
    : undefined
}

function parsePair(value: string | null): [number, number] | undefined {
  if (!value) return undefined
  const [first, second, ...extra] = value.split(',').map(Number)
  return !extra.length && Number.isFinite(first) && Number.isFinite(second) ? [first, second] : undefined
}

function parseIsoDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined
}

function setRange(params: URLSearchParams, key: string, range?: [number, number]) {
  if (range) params.set(key, `${range[0]},${range[1]}`)
}

export function encodeUrlState(state: AppUrlState) {
  const params = new URLSearchParams()
  params.set('v', String(SCENE_URL_VERSION))
  if (state.route && state.route !== 'home') params.set('page', state.route)
  if (state.dataset) params.set('dataset', state.dataset)
  if (state.mode) params.set('mode', state.mode)
  if (state.ref && state.ref !== 'sun') params.set('ref', state.ref)
  if (state.compareRef) params.set('compareRef', state.compareRef)
  if (state.compare) params.set('compare', '1')
  if (state.bodies?.length) params.set('bodies', state.bodies.join(','))
  if (state.jd !== undefined) params.set('jd', state.jd.toFixed(5))
  if (state.zoom !== undefined && state.zoom !== 1) params.set('zoom', state.zoom.toFixed(2))
  if (state.speed !== undefined && state.speed !== 30) params.set('speed', String(state.speed))
  if (state.history !== undefined && state.history !== 365) params.set('history', String(state.history))
  if (state.view && state.view !== '3d') params.set('view', state.view)
  if (state.filter && state.filter !== 'all') params.set('filter', state.filter)
  if (state.search) params.set('search', state.search)
  if (state.preset) params.set('preset', state.preset)
  if (state.story) params.set('story', state.story)
  if (state.step !== undefined && state.step > 0) params.set('step', String(Math.floor(state.step)))
  if (state.guide) params.set('guide', '1')
  if (state.missionFrom) params.set('from', state.missionFrom)
  if (state.missionTo) params.set('to', state.missionTo)
  if (state.departureDate) params.set('depart', state.departureDate)
  if (state.arrivalDate) params.set('arrive', state.arrivalDate)
  if (state.focused) params.set('focused', state.focused)
  if (state.plot) params.set('plot', state.plot)
  setRange(params, 'a', state.aRange)
  setRange(params, 'e', state.eRange)
  setRange(params, 'i', state.iRange)
  setRange(params, 'h', state.hRange)
  if (state.hStatus && state.hStatus !== 'all') params.set('hStatus', state.hStatus)
  setRange(params, 'q', state.qRange)
  if (state.layers !== undefined) params.set('layers', state.layers.join(','))
  if (state.offset && (state.offset[0] !== 0 || state.offset[1] !== 0)) setRange(params, 'pan', state.offset)
  if (state.lang) params.set('lang', state.lang)
  return params.toString()
}

export function decodeUrlState(search = typeof window === 'undefined' ? '' : window.location.search): AppUrlState {
  const params = new URLSearchParams(search)
  const encodedVersion = params.get('v')
  if (encodedVersion && encodedVersion !== String(SCENE_URL_VERSION) && encodedVersion !== String(LEGACY_SCENE_URL_VERSION)) return {}
  const version = encodedVersion === String(LEGACY_SCENE_URL_VERSION) ? LEGACY_SCENE_URL_VERSION : SCENE_URL_VERSION
  const state: AppUrlState = { version }
  const routes: AppRoute[] = ['home', 'explorer', 'catalog', 'elements', 'events', 'mission', 'stories', 'about']
  const route = params.get('page') as AppRoute | null
  if (route && routes.includes(route)) state.route = route
  const dataset = params.get('dataset')
  if (dataset) state.dataset = dataset
  const mode = params.get('mode')
  if (mode === 'lite' || mode === 'full') state.mode = mode
  const ref = params.get('ref')
  if (ref) state.ref = ref
  const compareRef = params.get('compareRef')
  if (compareRef) state.compareRef = compareRef
  state.compare = params.get('compare') === '1'
  const bodies = params.get('bodies')
  if (bodies) state.bodies = bodies.split(',').filter(Boolean)
  state.jd = finite(params.get('jd'))
  state.zoom = finite(params.get('zoom'))
  state.speed = finite(params.get('speed'))
  state.history = finite(params.get('history'))
  const view = params.get('view')
  if (view === '2d' || view === '3d') state.view = view
  const filter = params.get('filter')
  if (filter) state.filter = filter
  const searchText = params.get('search')
  if (searchText) state.search = searchText
  const preset = params.get('preset')
  if (preset) state.preset = preset
  const story = params.get('story')
  if (story) state.story = story
  const step = finite(params.get('step'))
  if (step !== undefined && step >= 0) state.step = Math.floor(step)
  state.guide = params.get('guide') === '1'
  const missionFrom = params.get('from')
  if (missionFrom) state.missionFrom = missionFrom
  const missionTo = params.get('to')
  if (missionTo) state.missionTo = missionTo
  state.departureDate = parseIsoDate(params.get('depart'))
  state.arrivalDate = parseIsoDate(params.get('arrive'))
  const focused = params.get('focused')
  if (focused) state.focused = focused
  const plot = params.get('plot') as ElementPlotMode | null
  if (plot && ['a-e', 'a-i', 'a-H', 'q-Q', 'a-period'].includes(plot)) state.plot = plot
  state.aRange = parseRange(params.get('a'))
  state.eRange = parseRange(params.get('e'))
  state.iRange = parseRange(params.get('i'))
  state.hRange = parseRange(params.get('h'))
  const hStatus = params.get('hStatus')
  if (hStatus === 'all' || hStatus === 'known' || hStatus === 'unknown') state.hStatus = hStatus
  state.qRange = parseRange(params.get('q'))
  state.offset = parsePair(params.get('pan'))
  if (params.has('layers')) {
    const knownLayers: ScientificLayer[] = ['ecliptic', 'orbits', 'lagrange', 'hill', 'soi', 'spacecraft']
    state.layers = (params.get('layers') ?? '').split(',').filter((layer): layer is ScientificLayer => knownLayers.includes(layer as ScientificLayer))
  }
  const lang = params.get('lang')
  if (lang === 'zh' || lang === 'en') state.lang = lang
  return state
}
