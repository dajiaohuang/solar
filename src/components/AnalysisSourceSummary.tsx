import type { AnalysisEphemerisEvidence, AnalysisEphemerisPolicy } from '../engine/ephemeris/analysisEphemeris'
import { useI18n } from '../i18n/context'

export function AnalysisPolicySelect({ value, onChange }: {
  value: AnalysisEphemerisPolicy; onChange: (value: AnalysisEphemerisPolicy) => void
}) {
  const { t } = useI18n()
  return <label className="field"><span>{t('analysisEphemerisPolicy')}</span>
    <select value={value} onChange={event => onChange(event.target.value as AnalysisEphemerisPolicy)}>
      <option value="prefer-spk">{t('analysisPreferSpk')}</option>
      <option value="require-spk">{t('analysisRequireSpk')}</option>
    </select>
  </label>
}

export function AnalysisSourceSummary({ evidence }: { evidence: AnalysisEphemerisEvidence | null | undefined }) {
  const { t } = useI18n()
  if (!evidence) return null
  const precise = evidence.bodies.filter(body => body.model === 'jpl-spk')
  const approximate = evidence.bodies.filter(body => body.model === 'approximate-fallback')
  return <div className="model-note" data-testid="analysis-source-summary">
    <b>{t('analysisStateSources')}</b>
    <p>SPK {precise.length} · {t('analysisApproximateStates')} {approximate.length}</p>
    <small>{t(evidence.policy === 'require-spk' ? 'analysisRequireSpk' : 'analysisPreferSpk')} · {evidence.frame} · {evidence.dynamicalTimeScale}</small>
    <details><summary>{t('analysisSourceDetails')}</summary><ul>{evidence.bodies.map(body => <li key={body.bodyId}>{body.bodyId}: {body.model} ({body.source})</li>)}</ul></details>
    <p className="fine-print">{t('analysisLoadedSourceBoundary')}</p>
  </div>
}
