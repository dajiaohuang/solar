import { useState } from 'react'
import { useI18n } from '../../i18n/context'
import { coveragePage, type summarizeBackendCoverage } from '../../lib/backendCoverage'
import type { BackendFrame, StateTileAudit } from '../../lib/backendFrames'

export function BackendCoverageLedger({ coverage, frame, referenceIds }: {
  coverage: ReturnType<typeof summarizeBackendCoverage>
  frame?: BackendFrame | null
  referenceIds: string[]
}) {
  const { t } = useI18n()
  const [requestedPage, setRequestedPage] = useState(0)
  const page = coveragePage(coverage.rows, requestedPage)
  return <section className="backend-coverage-ledger" data-testid="backend-coverage-ledger" aria-label={t('backendCoverage')}>
    <p>{t('backendCoverageBoundary')}</p>
    <dl>
      <div><dt>{t('coverageSelected')}</dt><dd>{coverage.selectedCount}</dd></div>
      <div><dt>{t('coverageReceived')}</dt><dd>{coverage.receivedCount}</dd></div>
      <div><dt>{t('coverageRequestIdentities')}</dt><dd>{coverage.uniqueRequestIdentities}</dd></div>
      <div><dt>{t('coverageExact')}</dt><dd>{coverage.exactCount}</dd></div>
      <div><dt>{t('coverageMissing')}</dt><dd>{coverage.missingCount}</dd></div>
      <div><dt>{t('coveragePending')}</dt><dd>{coverage.pendingCount}</dd></div>
      <div><dt>{t('coverageProjected')}</dt><dd>{coverage.projectedCount}</dd></div>
    </dl>
    <p>{t('coverageProjectionBoundary')}</p>
    {frame && <>
      <p>TDB JD {frame.epochTdbJd.toFixed(9)} · ECLIPJ2000</p>
      <p className="checksum">{t('coverageCatalogHash')}: {frame.catalogManifestSha256}</p>
      {frame.inventoryManifestSha256 && <p className="checksum">{t('coverageInventoryHash')}: {frame.inventoryManifestSha256}</p>}
      <p>{t('referenceFrame')}: {referenceIds.map(id => `${id}: ${frame.evidence.hasPosition(id) ? t('coverageExact') : t('coverageMissing')}`).join(', ')}</p>
    </>}
    {coverage.missingReasons.map(([reason, count]) => <p key={reason}>{t('coverageMissing')}: {reason} ({count})</p>)}
    {page.rows.length > 0 && <details className="coverage-rows">
      <summary>{t('coverageRowEvidence')} ({coverage.rows.length})</summary>
      <ul>{page.rows.map(row => <li key={row.bodyId}><AuditRow row={row} /></li>)}</ul>
      {page.pages > 1 && <nav aria-label={t('coverageRowEvidence')}>
        <button type="button" disabled={page.page === 0} onClick={() => setRequestedPage(page.page - 1)}>{t('coveragePrevious')}</button>
        <span>{page.page + 1}/{page.pages}</span>
        <button type="button" disabled={page.page + 1 >= page.pages} onClick={() => setRequestedPage(page.page + 1)}>{t('coverageNext')}</button>
      </nav>}
    </details>}
  </section>
}

function AuditRow({ row }: { row: StateTileAudit }) {
  const { t } = useI18n()
  return <details>
    <summary>{row.bodyId} · {row.backendId} · {row.missingReason || (row.precision !== 'exact' || row.availability !== 'operational' ? t('coveragePending') : row.model === 'source-kernel-state-at-audit-epoch' ? t('coverageSnapshot') : t('coverageExact'))}</summary>
    <dl>
      <div><dt>{t('source')}</dt><dd>{row.source || '—'}</dd></div>
      <div><dt>{t('model')}</dt><dd>{row.model || '—'}</dd></div>
      <div><dt>{t('dataset')}</dt><dd>{row.datasetVersion || '—'}</dd></div>
      <div><dt>{t('coverageValidity')}</dt><dd>{row.validityPresent ? `[${row.validityStartEt}, ${row.validityEndEt}]` : '—'}</dd></div>
      <div><dt>{t('coverageEvidenceWindow')}</dt><dd>{row.evidenceWindowPresent ? `[${row.evidenceWindowStartEt}, ${row.evidenceWindowEndEt}]` : '—'}</dd></div>
      <div><dt>{t('coverageStateEvidence')}</dt><dd>{row.stateEvidence || row.missingReason || '—'}</dd></div>
      <div><dt>{t('coverageKernelHash')}</dt><dd>{row.kernelSha256 || '—'}</dd></div>
      <div><dt>{t('coverageDatasetHash')}</dt><dd>{row.datasetSha256 || '—'}</dd></div>
    </dl>
  </details>
}
