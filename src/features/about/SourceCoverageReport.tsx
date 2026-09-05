import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import { CoverageUnavailableError, loadCoverageReport, type CoverageReport } from '../../lib/coverageReport'
import { PRODUCT_PROFILE } from '../../lib/productAvailability'

type State = { status: 'idle' | 'loading' | 'unavailable' | 'error' } | { status: 'ready'; report: CoverageReport }

export function SourceCoverageReport() {
  const { t, language } = useI18n()
  const [state, setState] = useState<State>({ status: 'idle' })
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])
  const base = import.meta.env.VITE_SOLAR_API_BASE_URL?.trim() || null
  const enabled = PRODUCT_PROFILE === 'full' && Boolean(base)
  async function load() {
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    setState({ status: 'loading' })
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const report = await loadCoverageReport(base, PRODUCT_PROFILE, controller.signal)
      if (active.current === controller) setState({ status: 'ready', report })
    } catch (error) {
      if (active.current === controller) setState({ status: error instanceof CoverageUnavailableError ? 'unavailable' : 'error' })
    } finally {
      clearTimeout(timeout)
      if (active.current === controller) active.current = null
    }
  }
  const report = state.status === 'ready' ? state.report : null
  const number = (value: number) => value.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')
  return <section className="evidence-module glass-panel source-coverage-report" data-testid="source-coverage-report">
    <h2>{t('sourceCoverageTitle')}</h2>
    <p>{t('sourceCoverageBoundary')}</p>
    {!enabled ? <p>{t(PRODUCT_PROFILE === 'preview' ? 'sourceCoveragePreview' : 'currentStatesNotConfigured')}</p> : <>
      <button type="button" className="secondary-button" disabled={state.status === 'loading'} onClick={() => void load()}>{t('sourceCoverageLoad')}</button>
      <p role="status">{state.status === 'loading' ? t('loading') : state.status === 'unavailable' ? t('sourceCoverageUnavailable') : state.status === 'error' ? t('sourceCoverageError') : ''}</p>
    </>}
    {report && <>
      <dl className="source-coverage-counts">
        <dt>{t('sourceCoverageRecords')}</dt><dd>{number(report.counts.sourceRecords)}</dd>
        <dt>{t('sourceCoverageMapped')}</dt><dd>{number(report.counts.mappedSourceRecords)}</dd>
        <dt>{t('sourceCoverageUnresolved')}</dt><dd>{number(report.counts.unresolvedSourceRecords)}</dd>
        <dt>{t('sourceCoverageTargets')}</dt><dd>{number(report.counts.explicitNaifTargets)}</dd>
        <dt>{t('sourceCoverageAvailable')}</dt><dd>{number(report.counts.availableTargetsAtAuditEpoch)}</dd>
        <dt>{t('sourceCoverageWindowComplete')}</dt><dd>{number(report.windowCounts.dependencyCoveredTargets)}</dd>
        <dt>{t('sourceCoverageWindowGaps')}</dt><dd>{number(report.windowCounts.targetsWithDependencyGaps)}</dd>
      </dl>
      <p>{t('sourceCoverageNotCertified')}</p>
      <p>{t('sourceCoverageEpoch')}: {report.auditEt}<br />{t('sourceCoverageWindow')}: {report.requestedWindow.startEt} … {report.requestedWindow.endEt}<br />{report.timeScale}; {report.frame}</p>
      <details><summary>{t('sourceCoverageReasons')}</summary>
        <dl className="source-coverage-counts">{report.unresolvedReasons.map(entry => <div key={entry.reason}><dt>{entry.reason}</dt><dd>{number(entry.count)}</dd></div>)}</dl>
      </details>
      <details><summary>{t('sourceCoverageProvenance')}</summary>
        <p>{t('sourceCoverageProvenanceBoundary')}</p>
        <p className="checksum">{report.catalogVersion}</p>
        {(['reportSha256', 'catalogManifestSha256', 'inventoryManifestSha256', 'sourceSnapshotSha256', 'identityMappingSha256', 'satelliteCatalogSha256'] as const).map(key => <p className="checksum" key={key}>{key}<br />{report[key]}</p>)}
      </details>
    </>}
  </section>
}
