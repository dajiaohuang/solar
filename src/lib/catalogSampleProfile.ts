import type { TranslationKey } from '../i18n/en'
import type { AsteroidManifest, CatalogSampleArtifact, CatalogSampleProfile } from '../types'

export type CatalogSampleRequest = {
  profile: string | null
  count: number | null
  countRaw?: string | null
  invalid: boolean
}

export type ResolvedCatalogSample = {
  profile: CatalogSampleProfile
  artifact: CatalogSampleArtifact
  key: string
  pinned: boolean
}

export type CatalogSampleError =
  | { code: 'tuple-required' }
  | { code: 'invalid-count'; value: string }
  | { code: 'unsupported-profile'; profile: string }
  | { code: 'profile-unavailable'; profile: string; datasetVersion: string }
  | { code: 'count-mismatch'; profile: string; expectedCount: number; requestedCount: number }

export type CatalogSampleResolution =
  | { sample: ResolvedCatalogSample; error: null }
  | { sample: null; error: CatalogSampleError | null }

export function catalogSampleErrorMessage(error: CatalogSampleError, t: (key: TranslationKey) => string) {
  if (error.code === 'tuple-required') return t('catalogSampleTupleRequired')
  if (error.code === 'invalid-count') return `${t('catalogSampleInvalidCount')}: ${error.value || '∅'}`
  if (error.code === 'unsupported-profile') return `${t('catalogSampleUnsupportedProfile')}: ${error.profile}`
  if (error.code === 'profile-unavailable') {
    return `${t('catalogSampleProfileUnavailable')}: ${error.profile} · ${error.datasetVersion}`
  }
  return `${t('catalogSampleCountMismatch')}: ${error.profile} · ${error.expectedCount} ≠ ${error.requestedCount}`
}

function isCatalogSampleProfile(value: string): value is CatalogSampleProfile {
  return value === 'desktop' || value === 'mobile'
}

export function resolveCatalogSampleProfile(
  manifest: AsteroidManifest,
  request: CatalogSampleRequest,
  viewportProfile: CatalogSampleProfile,
): CatalogSampleResolution {
  const hasExplicitRequest = request.invalid || request.profile !== null || request.count !== null
  if (request.invalid || (request.profile === null) !== (request.count === null)) {
    return {
      sample: null,
      error: request.invalid && request.profile && request.countRaw !== null && request.countRaw !== undefined
        ? { code: 'invalid-count', value: request.countRaw }
        : { code: 'tuple-required' },
    }
  }

  const profile = request.profile ?? viewportProfile
  if (!isCatalogSampleProfile(profile)) {
    return { sample: null, error: { code: 'unsupported-profile', profile } }
  }

  const artifact = manifest.precomputedSamples?.[profile]
  if (!artifact) {
    return hasExplicitRequest
      ? { sample: null, error: { code: 'profile-unavailable', profile, datasetVersion: manifest.version } }
      : { sample: null, error: null }
  }

  if (request.count !== null && request.count !== artifact.count) {
    return {
      sample: null,
      error: {
        code: 'count-mismatch',
        profile,
        expectedCount: artifact.count,
        requestedCount: request.count,
      },
    }
  }

  return {
    sample: {
      profile,
      artifact,
      key: `${manifest.version}:${profile}:${artifact.count}`,
      pinned: hasExplicitRequest,
    },
    error: null,
  }
}
