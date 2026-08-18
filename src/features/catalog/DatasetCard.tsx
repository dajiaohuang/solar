import { useI18n } from '../../i18n/context'
import { catalogStore } from '../../state/catalog-store'

export function DatasetCard({ compact = false }: { compact?: boolean }) {
  const catalog = catalogStore.useStore()
  const { t } = useI18n()
  if (!catalog.manifest) {
    return <div className={`dataset-card ${compact ? 'compact' : ''}`}><strong>{t('unavailable')}</strong><p>{t('buildHint')}</p></div>
  }
  const provenance = catalog.provenance
  return (
    <div className={`dataset-card ${compact ? 'compact' : ''}`}>
      <div className="dataset-status"><i /><span>{catalog.manifest.datasetMode?.toUpperCase() ?? 'LEGACY'}</span></div>
      <dl>
        <div><dt>{t('version')}</dt><dd>{catalog.manifest.version}</dd></div>
        <div><dt>{t('objects')}</dt><dd>{catalog.manifest.totalCount.toLocaleString()}</dd></div>
        {!compact && <>
          <div><dt>{t('source')}</dt><dd>MPCORB · Minor Planet Center</dd></div>
          <div><dt>{t('generated')}</dt><dd>{new Date(catalog.manifest.generatedAt).toLocaleString()}</dd></div>
          <div><dt>{t('checksum')}</dt><dd className="checksum">{provenance?.sourceSha256 ?? catalog.manifest.sourceSha256 ?? 'legacy / unavailable'}</dd></div>
          <div><dt>{t('propagation')}</dt><dd>{provenance?.orbitModel ?? catalog.manifest.orbitModel}</dd></div>
        </>}
      </dl>
    </div>
  )
}
