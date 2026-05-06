import type { BodyId } from '../types'

type AppUrlState = {
  ref?: BodyId
  bodies?: BodyId[]
  offset?: number
  zoom?: number
  speed?: number
  history?: number
  filter?: string
  search?: string
  preset?: string
}

export function encodeUrlState(state: AppUrlState) {
  const params = new URLSearchParams()

  if (state.ref && state.ref !== 'sun') {
    params.set('ref', state.ref)
  }

  if (state.bodies && state.bodies.length > 0) {
    params.set('bodies', state.bodies.join(','))
  }

  if (state.offset !== undefined && state.offset !== 0) {
    params.set('offset', String(Math.round(state.offset)))
  }

  if (state.zoom !== undefined && state.zoom !== 1) {
    params.set('zoom', state.zoom.toFixed(1))
  }

  if (state.speed !== undefined && state.speed !== 120) {
    params.set('speed', String(state.speed))
  }

  if (state.history !== undefined && state.history !== 365) {
    params.set('history', String(state.history))
  }

  if (state.filter && state.filter !== 'MBA') {
    params.set('filter', state.filter)
  }

  if (state.search) {
    params.set('search', state.search)
  }

  if (state.preset) {
    params.set('preset', state.preset)
  }

  return params.toString()
}

export function decodeUrlState(): AppUrlState {
  const params = new URLSearchParams(window.location.search)
  const state: AppUrlState = {}

  const ref = params.get('ref')
  if (ref) {
    state.ref = ref
  }

  const bodies = params.get('bodies')
  if (bodies) {
    state.bodies = bodies.split(',').filter(Boolean)
  }

  const offset = params.get('offset')
  if (offset !== null) {
    state.offset = Number(offset)
  }

  const zoom = params.get('zoom')
  if (zoom !== null) {
    state.zoom = Number(zoom)
  }

  const speed = params.get('speed')
  if (speed !== null) {
    state.speed = Number(speed)
  }

  const history = params.get('history')
  if (history !== null) {
    state.history = Number(history)
  }

  const filter = params.get('filter')
  if (filter) {
    state.filter = filter
  }

  const search = params.get('search')
  if (search) {
    state.search = search
  }

  const preset = params.get('preset')
  if (preset) {
    state.preset = preset
  }

  return state
}
