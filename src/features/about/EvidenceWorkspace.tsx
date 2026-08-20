import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n/context'
import { BUILD_INFO } from '../../lib/buildInfo'
import { catalogStore } from '../../state/catalog-store'
import { DatasetCard } from '../catalog/DatasetCard'

type ValidationReport = {
  passed?: boolean
  validObjects?: number
  rejectedObjects?: number
  rejectedFraction?: number
  numericRanges?: Record<string, [number, number]>
  invariants?: Record<string, boolean | number>
}

type ScientificValidationReport = {
  passed: boolean | null
  generatedAt: string
  runner: { totalTests: number; passedTests: number; failedTests: number }
  modelWindow?: { planetaryApproximation: string; outsideWindow: string }
  benchmarks?: Record<string, { passed?: boolean; count?: number; source?: string; contract?: string; residualContract?: string }>
  build?: { commitSha?: string }
}

export function EvidenceWorkspace() {
  const catalog = catalogStore.useStore()
  const { t, language } = useI18n()
  const [validation, setValidation] = useState<ValidationReport | null>(null)
  const [scientificValidation, setScientificValidation] = useState<ScientificValidationReport | null>(null)
  const validationRoot = catalog.manifest?.releasePath
  useEffect(() => {
    if (!validationRoot) return
    const controller = new AbortController()
    void fetch(`${validationRoot}/validation-report.json`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<ValidationReport> : null)
      .then(setValidation)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setValidation(null)
      })
    return () => controller.abort()
  }, [validationRoot])
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`${import.meta.env.BASE_URL}scientific-validation.json`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<ScientificValidationReport> : null)
      .then(setScientificValidation)
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setScientificValidation(null) })
    return () => controller.abort()
  }, [])
  const activeValidation = validationRoot ? validation : null
  const validationRuleCount = useMemo(() => Object.values(activeValidation?.invariants ?? {}).filter((value) => value === true || (typeof value === 'number' && value > 0)).length, [activeValidation])

  return <div className="workspace-page evidence-workspace">
    <header className="page-heading"><div><span className="eyebrow">{t('evidenceKicker')}</span><h1>{t('about')}</h1><p>{t('educationalWarning')}</p></div></header>
    <div className="evidence-grid">
      <section className="evidence-module glass-panel"><div className="module-heading"><span>{t('provenance')}</span><em>{t('dataLayer').toUpperCase()}</em></div><DatasetCard /></section>

      <section className="evidence-module glass-panel"><div className="module-heading"><span>{t('validation')}</span><em className={activeValidation?.passed ? 'pass' : ''}>{activeValidation ? (activeValidation.passed ? t('validationPass') : t('validationReview')) : t('validationMissing')}</em></div>{activeValidation ? <>
        <div className="hero-metric"><strong>{(activeValidation.validObjects ?? 0).toLocaleString()}</strong><span>{t('validatedRecords')}</span></div>
        <div className="metric-grid"><Metric label={t('rejected')} value={(activeValidation.rejectedObjects ?? 0).toLocaleString()} /><Metric label={t('rejectedFraction')} value={`${((activeValidation.rejectedFraction ?? 0) * 100).toFixed(3)}%`} /></div>
        <div className="invariant-list">{Object.entries(activeValidation.invariants ?? {}).map(([key, value]) => <div key={key}><i className={value ? 'pass' : 'fail'} />{key}<strong>{String(value)}</strong></div>)}</div>
      </> : <p className="muted-copy">{t('installV3Dataset')}</p>}</section>

      <section className="evidence-module scientific-validation glass-panel"><div className="module-heading"><span>{t('modelValidation')}</span><em className={scientificValidation?.passed ? 'pass' : ''}>{scientificValidation ? scientificValidation.passed === null ? t('validationMissing') : scientificValidation.passed ? t('validationPass') : t('validationReview') : t('loading')}</em></div>{scientificValidation ? <><div className="hero-metric"><strong>{scientificValidation.runner.passedTests}/{scientificValidation.runner.totalTests}</strong><span>{t('publicScientificChecks')}</span></div><div className="scientific-check-list">{Object.entries(scientificValidation.benchmarks ?? {}).map(([name, benchmark]) => <div key={name}><i className={benchmark.passed ? 'pass' : ''} /><span><strong>{name}</strong><small>{benchmark.source ?? benchmark.contract ?? benchmark.residualContract}</small></span><b>{benchmark.passed ? t('validationPass') : t('validationReview')}</b></div>)}</div><p className="fine-print">{t('modelValidityWindow')}: {scientificValidation.modelWindow?.planetaryApproximation ?? '—'} · {t('generated')} {new Date(scientificValidation.generatedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en')}</p><a className="validation-page-link" href={`${import.meta.env.BASE_URL}${language === 'zh' ? 'zh/' : ''}validation/`}>{t('openValidationPage')} ↗</a></> : <p className="muted-copy">{t('scientificValidationUnavailable')}</p>}</section>

      <section className="evidence-module build-identity glass-panel">
        <div className="module-heading"><span>{t('buildIdentity')}</span><em>BUILD</em></div>
        <dl className="identity-list">
          <div><dt>{t('appVersion')}</dt><dd>v{BUILD_INFO.version}</dd></div>
          <div><dt>{t('commitSha')}</dt><dd className="checksum">{BUILD_INFO.commitSha}</dd></div>
          <div><dt>{t('buildTime')}</dt><dd>{new Date(BUILD_INFO.buildTime).toLocaleString(language === 'zh' ? 'zh-CN' : 'en')}</dd></div>
          <div><dt>{t('deployment')}</dt><dd>{BUILD_INFO.environment}</dd></div>
          <div><dt>{t('dataset')}</dt><dd>{catalog.manifest?.version ?? BUILD_INFO.datasetVersion ?? t('noDataset')}</dd></div>
          <div><dt>{t('parserVersion')}</dt><dd>{catalog.provenance?.parserVersion ?? catalog.manifest?.parserVersion ?? '—'}</dd></div>
          <div><dt>{t('dataGenerated')}</dt><dd>{catalog.manifest?.generatedAt ? new Date(catalog.manifest.generatedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en') : '—'}</dd></div>
          <div><dt>{t('validationRules')}</dt><dd>{activeValidation ? validationRuleCount : '—'}</dd></div>
        </dl>
        <div className="identity-links"><a href="https://github.com/dajiaohuang/solar" target="_blank" rel="noreferrer">{t('githubSource')} ↗</a><a href="https://github.com/dajiaohuang/solar/blob/main/CHANGELOG.md" target="_blank" rel="noreferrer">{t('changelog')} ↗</a><a href="https://github.com/dajiaohuang/solar/issues/new/choose" target="_blank" rel="noreferrer">{t('reportIssue')} ↗</a></div>
      </section>

      <section className="evidence-module architecture-card glass-panel"><div className="module-heading"><span>{t('architecture')}</span><em>{t('engineLayer').toUpperCase()}</em></div><div className="architecture-flow"><div><b>{t('dataLayer')}</b><span>{t('mpcSnapshot')}</span><span>SHA-256</span><span>{t('binaryShards')}</span></div><i>→</i><div><b>{t('engineLayer')}</b><span>{t('externalClock')}</span><span>{t('cancellableWorkers')}</span><span>{t('sharedResolver')}</span></div><i>→</i><div><b>{t('viewsLayer')}</b><span>{t('catalogPoints')}</span><span>{t('focusTrajectories')}</span><span>{t('elementSpaceLabel')}</span></div></div></section>

      <section className="evidence-module contract-module glass-panel"><div className="module-heading"><span>{t('scientificContract')}</span><em>MODELS</em></div><dl className="contract-list"><div><dt>{t('majorPlanets')}</dt><dd>{t('majorPlanetsContract')}</dd></div><div><dt>{t('curatedBodies')}</dt><dd>{t('curatedBodiesContract')}</dd></div><div><dt>{t('smallBodies')}</dt><dd>{t('smallBodiesContract')}</dd></div><div><dt>{t('spacecraft')}</dt><dd>{t('spacecraftContract')}</dd></div><div><dt>{t('events')}</dt><dd>{t('eventsContract')}</dd></div><div><dt>{t('mission')}</dt><dd>{t('missionsContract')}</dd></div><div><dt>{t('sceneLinks')}</dt><dd>{t('sceneLinksContract')}</dd></div></dl></section>

      <section className="evidence-module source-links glass-panel"><div className="module-heading"><span>{t('source')}</span><em>PRIMARY</em></div><a href="https://www.minorplanetcenter.net/iau/MPCORB.html" target="_blank" rel="noreferrer"><span>MPCORB</span><small>{t('mpcSourceDescription')}</small><b>↗</b></a><a href="https://ssd-api.jpl.nasa.gov/doc/sbdb.html" target="_blank" rel="noreferrer"><span>JPL SBDB API</span><small>{t('sbdbSourceDescription')}</small><b>↗</b></a><a href="https://ssd.jpl.nasa.gov/planets/approx_pos.html" target="_blank" rel="noreferrer"><span>JPL approximate positions</span><small>{t('jplSourceDescription')}</small><b>↗</b></a></section>

      <section className="evidence-module glass-panel"><div className="module-heading"><span>{t('openSource')}</span><em>MIT</em></div><p className="large-copy">{t('openSourceCopy')}</p><p className="fine-print">{t('copyrightCopy')}</p></section>
    </div>
  </div>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }
