import { CANONICAL_APP_URL } from './platform'

const NATIVE_SCENE_EVENT = 'solar-atlas-native-scene'
let pendingSceneLocation: string | null = null

export function resolveNativeSceneLocation(url: string, currentPathname: string) {
  try {
    const incoming = new URL(url)
    const canonical = new URL(CANONICAL_APP_URL)
    const isCustomScene = incoming.protocol === 'solaratlas:' && incoming.host === 'scene'
    const isCanonicalScene = incoming.origin === canonical.origin && incoming.pathname.startsWith(canonical.pathname)
    if (!isCustomScene && !isCanonicalScene) return null
    return `${currentPathname}${incoming.search}${incoming.hash}`
  } catch {
    return null
  }
}

export function publishNativeSceneLocation(location: string) {
  pendingSceneLocation = location
  window.dispatchEvent(new Event(NATIVE_SCENE_EVENT))
}

export function onNativeSceneLocation(callback: (location: string) => void) {
  const consume = () => {
    if (!pendingSceneLocation) return
    const location = pendingSceneLocation
    pendingSceneLocation = null
    callback(location)
  }
  window.addEventListener(NATIVE_SCENE_EVENT, consume)
  consume()
  return () => window.removeEventListener(NATIVE_SCENE_EVENT, consume)
}
