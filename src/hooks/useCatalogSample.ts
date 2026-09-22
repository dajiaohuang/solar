import { useEffect } from 'react'
import { loadAsteroidSample, loadCatalogSummary } from '../lib/catalogLoader'
import { resolveCatalogSampleProfile } from '../lib/catalogSampleProfile'
import { classifyRenderDevice } from '../lib/renderBudget'
import { catalogActions, catalogStore } from '../state/catalog-store'
import type { CatalogSampleProfile } from '../types'
import { PRODUCT_PROFILE, PREVIEW_PROFILE } from '../lib/productAvailability'

export function catalogSampleSize(): CatalogSampleProfile {
  if (PRODUCT_PROFILE === 'preview') return PREVIEW_PROFILE.catalog.profile as CatalogSampleProfile
  return classifyRenderDevice(
    window.innerWidth,
    window.matchMedia('(pointer: coarse) and (max-width: 1180px)').matches,
  )
}

export function useCatalogSample(enabled = true) {
  const manifest = catalogStore.useStore((state) => state.manifest)
  const baseSampleKey = catalogStore.useStore((state) => state.baseSampleKey)
  const requestedSampleProfile = catalogStore.useStore((state) => state.requestedSampleProfile)
  const requestedSampleCount = catalogStore.useStore((state) => state.requestedSampleCount)
  const requestedSampleCountRaw = catalogStore.useStore((state) => state.requestedSampleCountRaw)
  const requestedSampleInvalid = catalogStore.useStore((state) => state.requestedSampleInvalid)

  useEffect(() => {
    if (!enabled || !manifest) return
    const resolution = resolveCatalogSampleProfile(manifest, {
      profile: requestedSampleProfile,
      count: requestedSampleCount,
      countRaw: requestedSampleCountRaw,
      invalid: requestedSampleInvalid,
    }, catalogSampleSize())
    if (resolution.error) {
      catalogActions.patch({
        baseSampleKey: null,
        baseSampleProfile: null,
        baseSampleRecords: [],
        sampleLoading: false,
        sampleLoadError: null,
        sampleError: resolution.error,
      })
      return
    }
    if (!resolution.sample) {
      catalogActions.patch({ sampleError: null })
      return
    }
    const { profile, key } = resolution.sample
    if (baseSampleKey === key) {
      if (catalogStore.getState().sampleError) catalogActions.patch({ sampleError: null })
      return
    }
    const controller = new AbortController()
    // Sample transport must not finish or clear errors from independent search,
    // paging or exact-scan work in the catalog workspace.
    catalogActions.patch({ sampleLoading: true, sampleLoadError: null, sampleError: null })
    void Promise.all([loadAsteroidSample(manifest, profile, controller.signal), loadCatalogSummary(manifest, controller.signal)]).then(([records, summary]) => {
      if (controller.signal.aborted || catalogStore.getState().manifest?.version !== manifest.version) return
      catalogActions.setBaseSample(profile, key, records, summary)
      catalogActions.patch({ sampleLoading: false })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) catalogActions.patch({
        sampleLoading: false,
        sampleLoadError: error instanceof Error ? error.message : String(error),
      })
      controller.abort()
    })
    return () => { controller.abort(); catalogActions.patch({ sampleLoading: false }) }
  }, [baseSampleKey, enabled, manifest, requestedSampleCount, requestedSampleCountRaw, requestedSampleInvalid, requestedSampleProfile])
}
