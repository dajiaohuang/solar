import type { ViewMode } from '../state/simulation-store'

export type ViewCapabilities = {
  zoom: boolean
  offset: boolean
  fullOrbits: boolean
  hillSphere: boolean
  laplaceSoi: boolean
  ecliptic: boolean
  lagrange: boolean
  spacecraft: boolean
  catalogCloud: boolean
}

export const VIEW_CAPABILITIES: Record<ViewMode, ViewCapabilities> = {
  '2d': { zoom: true, offset: true, fullOrbits: true, hillSphere: true, laplaceSoi: true, ecliptic: true, lagrange: true, spacecraft: true, catalogCloud: true },
  '3d': { zoom: true, offset: false, fullOrbits: false, hillSphere: false, laplaceSoi: false, ecliptic: true, lagrange: true, spacecraft: true, catalogCloud: true },
}
