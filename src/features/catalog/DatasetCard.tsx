import { useI18n } from '../../i18n/context'
import { catalogStore } from '../../state/catalog-store'

export function DatasetCard({ compact = false }: { compact?: boolean }) {
  const catalog = catalogStore.useStore()
  const { t } = useI18n()
  if (!catalog.manifest) {
    const requestedVersion = catalog.requestedDatasetVersion
    const openCurrent = () => {
      const url = new URL(window.location.href)
      url.searchParams.delete('dataset')
      window.location.assign(url)
    }
    return <div className={`dataset-card ${compact ? 'compact' : ''}`}>
      <strong>{requestedVersion ? t('requestedDatasetUnavailable') : t('unavailable')}</strong>
      {requestedVersion ? <>
        <p className="checksum">{requestedVersion}</p>
        <div className="inline-actions">
          <button onClick={openCurrent}>{t('openCurrentDataset')}</button>
          <button onClick={() => window.location.reload()}>{t('retry')}</button>
          <a href={`https://github.com/dajiaohuang/solar/releases/tag/dataset-${encodeURIComponent(requestedVersion)}`} target="_blank" rel="noreferrer">{t('releaseMetadata')}</a>
        </div>
      </> : <p>{t('buildHint')}</p>}
    </div>
  }
  const provenance = catalog.provenance
  const summary = catalog.summary
  const leadingClasses = summary
    ? Object.entries(summary.categoryCounts).sort(([, left], [, right]) => right - left).slice(0, 3)
    : []
  return (
    <div className={`dataset-card ${compact ? 'compact' : ''}`}>
      <div className="dataset-status"><i /><span>{catalog.manifest.datasetMode?.toUpperCase() ?? 'LEGACY'}</span></div>
      <dl>
        <div><dt>{t('version')}</dt><dd>{catalog.manifest.version}</dd></div>
        <div><dt>{t('objects')}</dt><dd>{catalog.manifest.totalCount.toLocaleString()}</dd></div>
        {!compact && <>
          <div><dt>{t('source')}</dt><dd>MPCORB · Minor Planet Center</dd></div>
          <div><dt>{t('generated')}</dt><dd>{new Date(catalog.manifest.generatedAt).toLocaleString()}</dd></div>
          <div><dt>{t('checksum')} · source</dt><dd className="checksum">{provenance?.sourceSha256 ?? catalog.manifest.sourceSha256 ?? 'legacy / unavailable'}</dd></div>
          <div><dt>{t('checksum')} · content</dt><dd className="checksum">{provenance?.contentSha256 ?? catalog.manifest.contentSha256 ?? 'legacy / unavailable'}</dd></div>
          <div><dt>{t('selectionPolicy')}</dt><dd>{provenance?.selectionPolicy?.type ?? catalog.manifest.selectionPolicy?.type ?? 'legacy / unspecified'}</dd></div>
          <div><dt>{t('propagation')}</dt><dd>{provenance?.orbitModel ?? catalog.manifest.orbitModel}</dd></div>
          {summary && <>
            <div><dt>H coverage</dt><dd>{summary.magnitudeKnownCount?.toLocaleString() ?? '—'} known · {summary.magnitudeUnknownCount?.toLocaleString() ?? '—'} unknown</dd></div>
            <div><dt>Largest classes</dt><dd>{leadingClasses.map(([code, count]) => `${code} ${count.toLocaleString()}`).join(' · ')}</dd></div>
            <div><dt>a / i range</dt><dd>{summary.numericRanges.semiMajorAxisAU?.map((value) => value.toFixed(2)).join('–')} AU · {summary.numericRanges.inclinationDeg?.map((value) => value.toFixed(1)).join('–')}°</dd></div>
          </>}
        </>}
      </dl>
    </div>
  )
}
