import { useEffect } from 'react'
import { loadAsteroidSample, loadCatalogSummary } from '../lib/catalogLoader'
import { catalogActions, catalogStore } from '../state/catalog-store'

export function catalogSampleSize() {
  return window.matchMedia('(max-width: 800px)').matches ? 'mobile' as const : 'desktop' as const
}

export function useCatalogSample() {
  const manifest = catalogStore.useStore((state) => state.manifest)
  const baseSampleKey = catalogStore.useStore((state) => state.baseSampleKey)

  useEffect(() => {
    if (!manifest?.precomputedSamples) return
    const size = catalogSampleSize()
    const key = `${manifest.version}:${size}`
    if (baseSampleKey === key) return
    let cancelled = false
    catalogActions.patch({ isLoading: true, error: null })
    void Promise.all([loadAsteroidSample(manifest, size), loadCatalogSummary(manifest)]).then(([records, summary]) => {
      if (cancelled || catalogStore.getState().manifest?.version !== manifest.version) return
      catalogActions.setBaseSample(key, records, summary)
      catalogActions.patch({ isLoading: false })
    }).catch((error: unknown) => {
      if (!cancelled) catalogActions.patch({
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return () => { cancelled = true }
  }, [baseSampleKey, manifest])
}
