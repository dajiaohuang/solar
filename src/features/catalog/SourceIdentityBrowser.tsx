import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import { PRODUCT_PROFILE } from '../../lib/productAvailability'
import { inspectSourceIdentityPage, loadSourceIdentityPage, type SourceIdentityPage } from '../../lib/sourceIdentityPage'

export function SourceIdentityBrowser() {
  const { t } = useI18n()
  const [query, setQuery] = useState(''), [epoch, setEpoch] = useState('2461287.5')
  const [page, setPage] = useState<SourceIdentityPage | null>(null)
  const [result, setResult] = useState<Awaited<ReturnType<typeof inspectSourceIdentityPage>> | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const active = useRef<AbortController | null>(null)
  const base = import.meta.env.VITE_SOLAR_API_BASE_URL?.trim() || null
  const enabled = PRODUCT_PROFILE === 'full' && Boolean(base)
  function cancel() { active.current?.abort(); active.current = null; setStatus('idle') }
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])
  async function run(operation: 'first' | 'next' | 'states') {
    cancel(); setResult(null)
    const previous = operation === 'next' ? page ?? undefined : undefined
    if (operation !== 'states') setPage(null)
    const controller = new AbortController(); active.current = controller; setStatus('loading')
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const params = { base, profile: PRODUCT_PROFILE, signal: controller.signal }
      if (operation === 'states' && page) {
        const inspected = await inspectSourceIdentityPage({ ...params, page, epochTdbJd: epoch.trim() ? Number(epoch) : NaN })
        if (active.current === controller) setResult(inspected)
      } else {
        const loaded = await loadSourceIdentityPage({ ...params, query: query.trim(), previous })
        if (active.current === controller) setPage(loaded)
      }
      if (active.current === controller) setStatus('idle')
    } catch {
      if (active.current === controller) { setPage(null); setResult(null); setStatus('error') }
    } finally { clearTimeout(timer); if (active.current === controller) active.current = null }
  }
  return <details className="source-identity-browser glass-panel" data-testid="source-identity-browser"
    onToggle={event => { if (!event.currentTarget.open) { cancel(); setPage(null); setResult(null) } }}>
    <summary>{t('sourceIdentityTitle')}</summary>
    <p>{t('sourceIdentityBoundary')}</p>
    {!enabled && <p>{t(PRODUCT_PROFILE === 'preview' ? 'sourceCoveragePreview' : 'currentStatesNotConfigured')}</p>}
    <label className="field"><span>{t('sourceIdentityQuery')}</span><input value={query} maxLength={256} disabled={!enabled}
      onChange={event => { cancel(); setQuery(event.target.value); setPage(null); setResult(null) }} /></label>
    <div className="inline-actions">
      <button className="secondary-button" disabled={!enabled || status === 'loading'} onClick={() => void run('first')}>{t('sourceIdentityBrowse')}</button>
      {page?.nextPageToken && <button className="secondary-button" disabled={status === 'loading'} onClick={() => void run('next')}>{t('sourceIdentityNext')}</button>}
      {status === 'loading' && <button className="secondary-button" onClick={cancel}>{t('sourceIdentityCancel')}</button>}
    </div>
    <p role="status">{status === 'loading' ? t('loading') : status === 'error' ? t('sourceIdentityError') : ''}</p>
    {page && <>
      <p data-testid="source-identity-counts">{t('sourceIdentityRows')}: {page.items.length} · {t('sourceCoverageRecords')}: {page.totalRecords.toLocaleString()}</p>
      <p className="checksum">{page.manifest.inventoryManifestSha256}</p>
      {!page.items.length && <p>{t('sourceIdentityEmpty')}</p>}
      <ul>{page.items.map(row => <li key={row.id}>
        <strong>{row.name || row.designation || row.id}</strong><p className="checksum">{row.id}</p>
        <p>{row.category} · {row.source} · {row.sourceRow}</p>
        <p>{t('sourceIdentityAssertion')}: {row.identityStatus} · {row.ephemerisStatus}</p>
      </li>)}</ul>
      <label className="field"><span>{t('sourceIdentityEpoch')}</span><input value={epoch} onChange={event => { cancel(); setEpoch(event.target.value); setResult(null) }} /></label>
      <button className="secondary-button" disabled={!page.items.length || status === 'loading'} onClick={() => void run('states')}>{t('sourceIdentityInspect')}</button>
    </>}
    {result && <section data-testid="source-identity-states">
      <p>{t('sourceIdentityVerified')}: {result.plan.exactCount} · {t('sourceIdentityMissing')}: {result.plan.missingCount}</p>
      <p>TDB JD {result.plan.epochJd} · ECLIPJ2000 · naif:0 · km · km/s</p>
      <p className="checksum">{result.plan.catalogManifestSha256}<br />{result.plan.inventoryManifestSha256}</p>
      {result.tiles.flatMap(tile => tile.metadata.map((row, index) => {
        const exact = Boolean(tile.exactBitmap[index >> 3] & (1 << (index & 7)))
        return <details key={row.id}><summary>{row.id}: {t(exact ? 'sourceIdentityVerified' : 'sourceIdentityMissing')}</summary>
          <p>{row.source} · {row.datasetVersion} · {row.model}</p><p>{row.missingReason}</p>
          <p>{row.centerId} · {row.stateEvidence} · {row.availability}</p>
          {exact && <p className="checksum">{Array.from(tile.states.subarray(index * 6, index * 6 + 6)).join(', ')}</p>}
          <p className="checksum">{row.datasetSha256}<br />{row.kernelSha256}<br />{tile.payloadSha256}</p>
          <p>{t('sourceIdentityValidity')}: {row.validityPresent ? `${row.validityStartEt} … ${row.validityEndEt}` : t('sourceIdentityMissing')}</p>
          {row.evidenceWindowPresent && <p>{t('sourceCoverageWindow')}: {row.evidenceWindowStartEt} … {row.evidenceWindowEndEt} (TDB ET)</p>}
        </details>
      }))}
    </section>}
  </details>
}
