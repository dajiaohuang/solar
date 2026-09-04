import { useEphemerides } from '../../hooks/useEphemerides'
import { useI18n } from '../../i18n/context'
import { EPHEMERIS_MANIFEST, ensureKernelFiles, kernelCoverage, kernelFilesForBodies, kernelsForWindow, loadedKernelIds } from '../../engine/ephemeris/kernelStore'
import { utcTimeScaleQuality } from '../../engine/ephemeris/timeScales'
import type { CelestialBody } from '../../types'

export function EphemerisStatus({ bodies, references, julianDay, historyDays }: { bodies: CelestialBody[]; references: CelestialBody[]; julianDay: number; historyDays: number }) {
  const state = useEphemerides()
  const { t, language } = useI18n()
  const coverage = bodies.map(body => ({ body, model: kernelCoverage(body, julianDay).model }))
  const covered = coverage.filter(item => item.model === 'jpl-spk')
  const unavailable = coverage.filter(item => item.model === 'unavailable').map(item => item.body)
  const fallback = coverage.filter(item => item.model === 'approximate-fallback').map(item => item.body.id)
  const loaded = loadedKernelIds()
  const bytes = EPHEMERIS_MANIFEST.files.filter((file) => loaded.includes(file.id)).reduce((sum, file) => sum + file.bytes, 0)
  const future = julianDay >= 2441317.5 && utcTimeScaleQuality(julianDay).status === 'future-uncertain'
  return <details className="ephemeris-status glass-panel" data-testid="ephemeris-status">
    <summary>{t('physicalEphemerides')}: {covered.length}/{bodies.length} · {state.loading ? t('loading') : t('geometricStates')}</summary>
    <p>{t('ephemerisBoundary')}</p>
    <p>{t('referenceFrame')}: {references.map((body) => `${body.id} · ${kernelCoverage(body, julianDay).model}`).join(', ')}</p>
    <p>{language === 'zh' ? '轨迹整窗可用内核' : 'Kernels covering the whole trail'}: {kernelsForWindow(julianDay - historyDays, julianDay).length}/{loaded.length}. {language === 'zh' ? '覆盖不完整的内核在整段扫描中停用，以免切换模型制造伪极值。' : 'Partially covered kernels are excluded for the whole scan to avoid model-switch artifacts.'}</p>
    <p>{t('ephemerisFallback')}: {fallback.join(', ') || '—'}</p>
    {unavailable.length > 0 && <p role="status">{t('bodyStateUnavailable')}: {unavailable.map(body => body.id).join(', ')}</p>}
    <p>{EPHEMERIS_MANIFEST.id} · {(bytes / 1048576).toFixed(1)} MiB · {t('ephemerisTimeBoundary')}</p>
    {future && <p role="status">{t('ephemerisFutureTime')}</p>}
    {state.error && <p role="alert">{state.error}</p>}
    <button onClick={() => void ensureKernelFiles(kernelFilesForBodies(bodies)).catch(() => undefined)}>{t('loadEphemerides')}</button>
    <a href="https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html" target="_blank" rel="noreferrer">JPL / NAIF SPK ↗</a>
  </details>
}
