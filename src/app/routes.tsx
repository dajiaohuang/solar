import { lazy, Suspense, type ComponentType } from 'react'
import type { AppRoute } from '../state/ui-store'

function lazyNamed<T extends Record<string, ComponentType>>(loader: () => Promise<T>, name: keyof T) {
  return lazy(async () => ({ default: (await loader())[name] }))
}
const ExplorerWorkspace = lazyNamed(() => import('../features/explorer/ExplorerWorkspace'), 'ExplorerWorkspace')
const CatalogWorkspace = lazyNamed(() => import('../features/catalog/CatalogWorkspace'), 'CatalogWorkspace')
const ElementSpaceWorkspace = lazyNamed(() => import('../features/element-space/ElementSpaceWorkspace'), 'ElementSpaceWorkspace')
const EventsWorkspace = lazyNamed(() => import('../features/events/EventsWorkspace'), 'EventsWorkspace')
const MissionWorkspace = lazyNamed(() => import('../features/mission/MissionWorkspace'), 'MissionWorkspace')
const StoriesWorkspace = lazyNamed(() => import('../features/stories/StoriesWorkspace'), 'StoriesWorkspace')
const EvidenceWorkspace = lazyNamed(() => import('../features/about/EvidenceWorkspace'), 'EvidenceWorkspace')

export function AppRouteView({ route }: { route: AppRoute }) {
  let View: ComponentType
  switch (route) {
    case 'catalog': View = CatalogWorkspace; break
    case 'elements': View = ElementSpaceWorkspace; break
    case 'events': View = EventsWorkspace; break
    case 'mission': View = MissionWorkspace; break
    case 'stories': View = StoriesWorkspace; break
    case 'about': View = EvidenceWorkspace; break
    case 'explorer':
    default: View = ExplorerWorkspace
  }
  return <Suspense fallback={<div className="route-loading"><i /><span>Loading workspace…</span></div>}><View /></Suspense>
}
