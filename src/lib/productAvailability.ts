import preview from '../data/preview-profile.json'
import datasetPin from '../../.github/asteroid-dataset.json'
import type { AppUrlState } from './urlState'
import type { ProductProfile } from '../data/productProfile'
export { productProfile } from '../data/productProfile'
export type { ProductProfile } from '../data/productProfile'

export type AvailabilityReason = 'body' | 'workspace' | 'story' | 'trajectory' | 'catalog' | 'spacecraft'
export type Availability = { available: true } | { available: false; reason: AvailabilityReason; resource: string }

export const PRODUCT_PROFILE: ProductProfile = typeof __SOLAR_PRODUCT_PROFILE__ === 'undefined' ? 'full' : __SOLAR_PRODUCT_PROFILE__
export const PREVIEW_PROFILE = preview
const includedBodies = new Set(preview.bodyIds)
const permitted: Availability = { available: true }
const denied = (reason: AvailabilityReason, resource: string): Availability => ({ available: false, reason, resource })

export function bodyAvailability(id: string | null | undefined, profile = PRODUCT_PROFILE): Availability {
  return profile === 'full' || id == null || includedBodies.has(id) ? permitted : denied('body', id)
}

export function routeAvailability(route: string, profile = PRODUCT_PROFILE): Availability {
  return profile === 'full' || preview.routes.includes(route) ? permitted : denied('workspace', route)
}

export function storyAvailability(id: string, profile = PRODUCT_PROFILE): Availability {
  return profile === 'full' || preview.storyIds.includes(id) ? permitted : denied('story', id)
}

export function catalogAvailability(operation: 'sample' | 'search' | 'details' | 'scan' | 'sbdb', profile = PRODUCT_PROFILE): Availability {
  return profile === 'full' || operation === 'sample' ? permitted : denied('catalog', operation)
}

/** Restricted actions remain focusable so keyboard and touch users can ask why. */
export function availabilityAttributes(result: Availability) {
  return {
    'aria-disabled': !result.available || undefined,
    'aria-describedby': !result.available ? 'preview-restriction-description' : undefined,
  }
}

/** Check the whole requested scene BEFORE applying any part or loading data.
 * Preserve the original URL separately; never filter bodies into a new scene. */
export function sceneAvailability(scene: AppUrlState, profile = PRODUCT_PROFILE): Availability {
  if (profile === 'full') return permitted
  const route = routeAvailability(scene.route ?? 'explorer', profile)
  if (!route.available) return route
  for (const id of [...(scene.bodies ?? []), scene.ref, scene.compareRef, scene.focused, scene.missionFrom, scene.missionTo]) {
    const body = bodyAvailability(id, profile)
    if (!body.available) return body
  }
  if (scene.story) {
    const story = storyAvailability(scene.story, profile)
    if (!story.available) return story
  }
  if ((scene.history ?? 0) > preview.maxHistoryDays || (scene.samples ?? 0) > preview.maxSamples) return denied('trajectory', 'extended')
  if (scene.layers?.includes('spacecraft')) return denied('spacecraft', 'spacecraft')
  if (scene.dataset !== undefined && scene.dataset !== datasetPin.version) return denied('catalog', 'dataset')
  if ((scene.catalogSample !== undefined && scene.catalogSample !== preview.catalog.profile)
    || (scene.catalogSampleCount !== undefined && scene.catalogSampleCount !== preview.catalog.sampleCount)) return denied('catalog', 'sample')
  return permitted
}
