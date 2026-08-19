import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n/context'
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

export function EvidenceWorkspace() {
  const catalog = catalogStore.useStore()
  const { t, language } = useI18n()
  const [validation, setValidation] = useState<ValidationReport | null>(null)
  useEffect(() => {
    const root = catalog.manifest?.releasePath
    if (!root) return
    void fetch(`${root}/validation-report.json`).then((response) => response.ok ? response.json() as Promise<ValidationReport> : null).then(setValidation).catch(() => setValidation(null))
  }, [catalog.manifest?.releasePath])
  return <div className="workspace-page evidence-workspace">
    <header className="page-heading"><div><span className="eyebrow">TRACEABLE INPUTS / EXPLICIT MODELS / REPRODUCIBLE URLS</span><h1>{t('about')}</h1><p>{t('educationalWarning')}</p></div></header>
    <div className="evidence-grid">
      <section className="evidence-module glass-panel"><div className="module-heading"><span>{t('provenance')}</span><em>DATA</em></div><DatasetCard /></section>
      <section className="evidence-module glass-panel"><div className="module-heading"><span>{t('validation')}</span><em className={validation?.passed ? 'pass' : ''}>{validation ? (validation.passed ? 'PASS' : 'REVIEW') : 'NO REPORT'}</em></div>{validation ? <><div className="hero-metric"><strong>{(validation.validObjects ?? 0).toLocaleString()}</strong><span>validated elliptic records</span></div><div className="metric-grid"><Metric label="Rejected" value={(validation.rejectedObjects ?? 0).toLocaleString()} /><Metric label="Rejected fraction" value={`${((validation.rejectedFraction ?? 0) * 100).toFixed(3)}%`} /></div><div className="invariant-list">{Object.entries(validation.invariants ?? {}).map(([key, value]) => <div key={key}><i className={value ? 'pass' : 'fail'} />{key}<strong>{String(value)}</strong></div>)}</div></> : <p className="muted-copy">{language === 'zh' ? '安装 v2 数据集后将显示机器生成的校验报告。' : 'Install a v2 dataset to inspect its machine-generated validation report.'}</p>}</section>
      <section className="evidence-module architecture-card glass-panel"><div className="module-heading"><span>{t('architecture')}</span><em>ENGINE</em></div><div className="architecture-flow"><div><b>DATA</b><span>MPC snapshot</span><span>SHA-256</span><span>Float64 shards</span></div><i>→</i><div><b>ENGINE</b><span>External clock</span><span>Cancellable workers</span><span>Shared resolver</span></div><i>→</i><div><b>VIEWS</b><span>Catalog points</span><span>Focus trajectories</span><span>Element space</span></div></div></section>
      <section className="evidence-module glass-panel"><div className="module-heading"><span>Scientific contract</span><em>MODELS</em></div><dl className="contract-list"><div><dt>Major planets</dt><dd>JPL approximate orbital elements with secular rates, valid for 1800–2050; dates outside that interval are explicitly marked as extrapolations.</dd></div><div><dt>Curated bodies</dt><dd>Rounded educational elements for selected moons and dwarf planets, labeled curated-approx rather than live JPL data.</dd></div><div><dt>Small bodies</dt><dd>Elliptic two-body propagation from an osculating MPCORB or JPL SBDB epoch.</dd></div><div><dt>Spacecraft</dt><dd>Milestone-dated schematic paths, explicitly separated from Horizons and operational ephemerides.</dd></div><div><dt>Events</dt><dd>Explicit bounded analysis: coarse candidates followed by local refinement and re-propagation at the refined Julian Day. Results do not auto-update during playback.</dd></div><div><dt>Missions</dt><dd>Circular Hohmann baseline and universal-variable Lambert solution; no N-body correction.</dd></div><div><dt>Scene links</dt><dd>Carry dataset version, epoch, frame, selection, filters, and view state.</dd></div></dl></section>
      <section className="evidence-module source-links glass-panel"><div className="module-heading"><span>{t('source')}</span><em>PRIMARY</em></div><a href="https://www.minorplanetcenter.net/iau/MPCORB.html" target="_blank" rel="noreferrer"><span>MPCORB</span><small>Minor Planet Center orbit catalog</small><b>↗</b></a><a href="https://ssd-api.jpl.nasa.gov/doc/sbdb.html" target="_blank" rel="noreferrer"><span>JPL SBDB API</span><small>Osculating elements and uncertainties</small><b>↗</b></a><a href="https://ssd.jpl.nasa.gov/planets/approx_pos.html" target="_blank" rel="noreferrer"><span>JPL approximate positions</span><small>Planetary mean-element model</small><b>↗</b></a></section>
      <section className="evidence-module glass-panel"><div className="module-heading"><span>{t('openSource')}</span><em>MIT</em></div><p className="large-copy">Solar Atlas separates application releases from immutable dataset releases. Every generated dataset includes provenance, checksums, and validation artifacts.</p><p className="fine-print">Copyright © 2026 Solar Atlas contributors. Source code is licensed under MIT; upstream astronomical data retains its source terms and attribution.</p></section>
    </div>
  </div>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }
