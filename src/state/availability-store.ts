import type { Availability } from '../lib/productAvailability'
import { createStore } from './createStore'

type Denial = Extract<Availability, { available: false }>
type AvailabilityState = { denial: Denial | null; open: boolean; requestedSceneUrl: string | null; preserveLocation: boolean }
export const availabilityStore = createStore<AvailabilityState>({ denial: null, open: false, requestedSceneUrl: null, preserveLocation: false })

export const availabilityActions = {
  require(result: Availability, requestedSceneUrl?: string) {
    if (result.available) return true
    availabilityStore.setState({ denial: result, open: true,
      ...(requestedSceneUrl ? { requestedSceneUrl, preserveLocation: true } : {}),
    })
    return false
  },
  explain() { availabilityStore.setState({ open: true }) },
  dismiss() { availabilityStore.setState({ open: false }) },
  // Explicitly choosing a preview scene permits URL updates. The original
  // request stays inspectable/copyable, not silently overwritten or applied.
  explorePreview() { availabilityStore.setState({ open: false, preserveLocation: false }) },
}
