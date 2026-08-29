import { useEffect } from 'react'
import { loadAsteroidSample, loadCatalogSummary } from '../lib/catalogLoader'
import { resolveCatalogSampleProfile } from '../lib/catalogSampleProfile'
import { classifyRenderDevice } from '../lib/renderBudget'
import { catalogActions, catalogStore } from '../state/catalog-store'
import type { CatalogSampleProfile } from '../types'

export function catalogSampleSize(): CatalogSampleProfile {
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
        isLoading: false,
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
    let cancelled = false
    catalogActions.patch({ isLoading: true, error: null, sampleError: null })
    void Promise.all([loadAsteroidSample(manifest, profile), loadCatalogSummary(manifest)]).then(([records, summary]) => {
      if (cancelled || catalogStore.getState().manifest?.version !== manifest.version) return
      catalogActions.setBaseSample(profile, key, records, summary)
      catalogActions.patch({ isLoading: false })
    }).catch((error: unknown) => {
      if (!cancelled) catalogActions.patch({
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return () => { cancelled = true }
  }, [baseSampleKey, enabled, manifest, requestedSampleCount, requestedSampleCountRaw, requestedSampleInvalid, requestedSampleProfile])
}
