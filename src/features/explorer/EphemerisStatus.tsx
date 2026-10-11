import { useEffect, useMemo, useRef, useState } from 'react'
import { useEphemerides } from '../../hooks/useEphemerides'
import { useI18n } from '../../i18n/context'
import { EPHEMERIS_MANIFEST, ensureKernelFiles, kernelCoverage, kernelFilesForBodies, kernelsForWindow, loadedKernelIds } from '../../engine/ephemeris/kernelStore'
import { utcTimeScaleQuality } from '../../engine/ephemeris/timeScales'
import type { CelestialBody } from '../../types'
import type { BackendFrame } from '../../lib/backendFrames'
import { summarizeBackendCoverage } from '../../lib/backendCoverage'
import { BackendCoverageLedger } from './BackendCoverageLedger'
import { PagedBodyList } from '../../components/PagedBodyList'
import type { ExactBackendCoverageCounts } from '../../lib/backendCoverage'
import { SEGMENTED_WEB, isDynamicOrbitBody } from '../../lib/webExecution'
import { getApproximationManifest, ensureApproximation } from '../../engine/ephemeris/segmentedStore'
import { bodyPositionOrNull, createBodyPositionResolver } from '../../lib/ephemeris'
import { builtInSceneBodies } from '../../app/bodyRegistry'

export function EphemerisStatus(props: Parameters<typeof KernelEphemerisStatus>[0]) {
  return SEGMENTED_WEB ? <SegmentedEphemerisStatus {...props} /> : <KernelEphemerisStatus {...props} />
}

function SegmentedEphemerisStatus({ bodies, references, julianDay }: Parameters<typeof KernelEphemerisStatus>[0]) {
  const state = useEphemerides()
  const { language, t } = useI18n()
  const manifest = getApproximationManifest()
  const resolve = createBodyPositionResolver(new Map([...builtInSceneBodies, ...bodies, ...references].map(body => [body.id, body])), julianDay)
  const missing = bodies.filter(body => !bodyPositionOrNull(resolve, body.id))
  return <details className="ephemeris-status glass-panel" data-testid="ephemeris-status" data-model="segmented-approximation">
    <summary>{language === 'zh' ? '分段轨道近似' : 'Segmented orbit approximation'}: {bodies.length - missing.length}/{bodies.length} · {state.loading ? t('loading') : language === 'zh' ? '浏览器本地求值' : 'Browser evaluation'}</summary>
    <p>{language === 'zh' ? '每段仅保留候选中抽样误差最小的一套近似；有效范围外无覆盖，不外推。' : 'Each segment retains the candidate with the lowest sampled error. No coverage or extrapolation outside its valid interval.'}</p>
    <p>{language === 'zh' ? '误差阈值（相对来源内核的验证点，不是连续误差界或物理不确定度）' : 'Validation thresholds against source kernels at sampled points; not continuous bounds or physical uncertainty'}: {manifest?.positionToleranceKm ?? 5} km · {manifest?.velocityToleranceKmS ?? .005} km/s.</p>
    <p>{language === 'zh' ? '参考系' : 'References'}: {references.map(body => `${body.id}: ${bodyPositionOrNull(resolve, body.id) ? language === 'zh' ? '有覆盖' : 'covered' : language === 'zh' ? '无覆盖' : 'no coverage'}`).join(', ')}</p>
    {manifest && <PagedBodyList as="ul" label={language === 'zh' ? '各天体覆盖范围（TDB；区间内也可能有缺口）' : 'Body coverage (TDB; intervals may contain gaps)'} bodies={bodies}>{body => {
      const coverage = manifest.bodies.find(entry => entry.id === body.id)
      const first = coverage?.chunks[0], last = coverage?.chunks.at(-1)
      const date = (et: number) => new Date(Date.UTC(2000, 0, 1, 12) + et * 1000).toISOString().slice(0, 10)
      return <li key={body.id}>{body.id}: {first && last ? `${date(first.startEt)} – ${date(last.endEt)} TDB` : coverage?.origin ? language === 'zh' ? '参考原点' : 'Reference origin' : body.source === 'mpcorb' ? 'MPCORB / Kepler' : language === 'zh' ? '无覆盖' : 'No coverage'}</li>
    }}</PagedBodyList>}
    {missing.length > 0 && <><p role="status">{language === 'zh' ? '无覆盖' : 'No coverage'}: {missing.length}</p><PagedBodyList as="ul" label={t('bodyStateUnavailable')} bodies={missing}>{body => <li key={body.id}>{body.id}</li>}</PagedBodyList></>}
    {bodies.some(isDynamicOrbitBody) && <p>{language === 'zh' ? 'MPCORB、SBDB 和自定义轨道使用原有二体轨道近似，没有全量精确星历或上述拟合误差保证。' : 'MPCORB, SBDB and custom orbits use the existing two-body approximation, without full exact ephemerides or the fit error receipt above.'}</p>}
    {julianDay >= 2441317.5 && utcTimeScaleQuality(julianDay).status === 'future-uncertain' && <p role="status">{t('ephemerisFutureTime')}</p>}
    {state.error && <><p role="alert">{state.error}</p><button onClick={() => { void ensureApproximation([...bodies, ...references], julianDay).catch(() => undefined) }}>{t('loadEphemerides')}</button></>}
  </details>
}

function KernelEphemerisStatus({ bodies, references, julianDay, historyDays, exactCoverageCounts, backendStatus, backendFrame }: { bodies: CelestialBody[]; references: CelestialBody[]; julianDay: number; historyDays: number; exactCoverageCounts: ExactBackendCoverageCounts; backendFrame?: BackendFrame | null; backendStatus?: { configured: boolean; loading: boolean; error: string | null; publishedEpochUtcJd?: number | null; requestedEpochUtcJd?: number } }) {
  const state = useEphemerides()
  const { t, language } = useI18n()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [localEvidenceOpen, setLocalEvidenceOpen] = useState(false)
  const [manualLoading, setManualLoading] = useState(false)
  const manualLoadController = useRef<AbortController | null>(null)
  useEffect(() => () => {
    manualLoadController.current?.abort()
    manualLoadController.current = null
  }, [])
  const loadOrCancelEphemerides = () => {
    const current = manualLoadController.current
    if (current) {
      manualLoadController.current = null
      current.abort()
      setManualLoading(false)
      return
    }
    const controller = new AbortController()
    manualLoadController.current = controller
    setManualLoading(true)
    void ensureKernelFiles(kernelFilesForBodies(bodies), controller.signal).catch(() => undefined).finally(() => {
      if (manualLoadController.current === controller) {
        manualLoadController.current = null
        setManualLoading(false)
      }
    })
  }
  const backendCoverage = useMemo(() => backendStatus?.configured && detailsOpen
    ? summarizeBackendCoverage(bodies, backendFrame)
    : null, [bodies, backendFrame, backendStatus?.configured, detailsOpen])
  const localCoverage = useMemo(() => {
    if (backendStatus?.configured && (!detailsOpen || !localEvidenceOpen)) return null
    void state.revision
    let coveredCount = 0
    const unavailableBodies: CelestialBody[] = [], fallbackBodies: CelestialBody[] = []
    for (const body of bodies) {
      const model = kernelCoverage(body, julianDay).model
      if (model === 'jpl-spk') coveredCount++
      else if (model === 'unavailable') unavailableBodies.push(body)
      else if (model === 'approximate-fallback') fallbackBodies.push(body)
    }
    return { coveredCount, unavailableBodies, fallbackBodies }
  }, [bodies, julianDay, state.revision, backendStatus?.configured, detailsOpen, localEvidenceOpen])
  const loaded = loadedKernelIds()
  const bytes = EPHEMERIS_MANIFEST.files.filter((file) => loaded.includes(file.id)).reduce((sum, file) => sum + file.bytes, 0)
  const future = julianDay >= 2441317.5 && utcTimeScaleQuality(julianDay).status === 'future-uncertain'
  const stale = backendStatus?.configured && backendStatus.publishedEpochUtcJd != null && backendStatus.requestedEpochUtcJd != null && Math.abs(backendStatus.publishedEpochUtcJd - backendStatus.requestedEpochUtcJd) > 1e-9
  const backendSummary = !backendStatus?.configured
    ? t('currentStatesNotConfigured')
    : stale
      ? (language === 'zh' ? `精确帧待更新 · 渲染 JD ${backendStatus.publishedEpochUtcJd!.toFixed(6)}` : `Exact frame pending · rendered JD ${backendStatus.publishedEpochUtcJd!.toFixed(6)}`)
      : backendStatus.loading ? t('currentStatesLoading') : backendStatus.error ?? ''
  return <details className="ephemeris-status glass-panel" data-testid="ephemeris-status" onToggle={event => setDetailsOpen(event.currentTarget.open)}>
    <summary>{backendStatus?.configured ? `${t('backendCoverage')}: ${exactCoverageCounts.exactCount}/${exactCoverageCounts.selectedCount}` : `${t('physicalEphemerides')}: ${localCoverage?.coveredCount ?? 0}/${bodies.length} · ${state.loading ? t('loading') : t('geometricStates')}`}{backendSummary ? ` · ${backendSummary}` : ''}</summary>
    {backendStatus?.configured && <p role={backendStatus.error ? 'alert' : 'status'}>{backendStatus.loading ? t('currentStatesLoading') : backendStatus.error ?? t('currentStatesConnected')}</p>}
    {backendStatus?.configured && backendStatus.publishedEpochUtcJd != null && backendStatus.requestedEpochUtcJd != null && Math.abs(backendStatus.publishedEpochUtcJd - backendStatus.requestedEpochUtcJd) > 1e-9 && (
      <p role="status">{language === 'zh' ? `正在等待精确帧：已渲染 JD ${backendStatus.publishedEpochUtcJd.toFixed(6)}；请求 JD ${backendStatus.requestedEpochUtcJd.toFixed(6)}。` : `Exact frame refresh pending: rendered JD ${backendStatus.publishedEpochUtcJd.toFixed(6)}; requested JD ${backendStatus.requestedEpochUtcJd.toFixed(6)}.`}</p>
    )}
    {!backendStatus?.configured && <p>{t('currentStatesNotConfigured')}</p>}
    {backendStatus?.configured && backendCoverage && <BackendCoverageLedger coverage={backendCoverage} frame={backendFrame} referenceIds={references.map(body => body.id)} />}
    <details data-testid="local-ephemeris-evidence" onToggle={event => setLocalEvidenceOpen(event.currentTarget.open)}>
    <summary>{t('localTrajectoryKernels')}: {localCoverage ? `${localCoverage.coveredCount}/${bodies.length}` : t('localCoverageDeferred')} · {state.loading ? t('loading') : t('geometricStates')}</summary>
    {localCoverage && <>
    <p>{t('ephemerisBoundary')}</p>
    <p>{t('referenceFrame')}: {references.map((body) => `${body.id} · ${kernelCoverage(body, julianDay).model}`).join(', ')}</p>
    <p>{language === 'zh' ? '轨迹整窗可用内核' : 'Kernels covering the whole trail'}: {kernelsForWindow(julianDay - historyDays, julianDay).length}/{loaded.length}. {language === 'zh' ? '覆盖不完整的内核在整段扫描中停用，以免切换模型制造伪极值。' : 'Partially covered kernels are excluded for the whole scan to avoid model-switch artifacts.'}</p>
    <p>{t('ephemerisFallback')}: {localCoverage.fallbackBodies.length.toLocaleString()}</p>
    {localCoverage.fallbackBodies.length > 0 && <PagedBodyList as="ul" label={t('ephemerisFallback')} bodies={localCoverage.fallbackBodies}>{body => <li key={body.id}>{body.id}</li>}</PagedBodyList>}
    {localCoverage.unavailableBodies.length > 0 && <><p role="status">{t('bodyStateUnavailable')}: {localCoverage.unavailableBodies.length.toLocaleString()}</p><PagedBodyList as="ul" label={t('bodyStateUnavailable')} bodies={localCoverage.unavailableBodies}>{body => <li key={body.id}>{body.id}</li>}</PagedBodyList></>}
    <p>{EPHEMERIS_MANIFEST.id} · {(bytes / 1048576).toFixed(1)} MiB · {t('ephemerisTimeBoundary')}</p>
    {future && <p role="status">{t('ephemerisFutureTime')}</p>}
    {state.error && <p role="alert">{state.error}</p>}
    <button onClick={loadOrCancelEphemerides}>{t(manualLoading ? 'cancelEphemerisLoad' : 'loadEphemerides')}</button>
    <a href="https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html" target="_blank" rel="noreferrer">JPL / NAIF SPK ↗</a>
    </>}
    </details>
  </details>
}
