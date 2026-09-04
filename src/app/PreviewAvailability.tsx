import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n/context'
import type { TranslationKey } from '../i18n/en'
import { PRODUCT_PROFILE, type AvailabilityReason } from '../lib/productAvailability'
import { availabilityActions, availabilityStore } from '../state/availability-store'
import { uiActions } from '../state/ui-store'

const reasons: Record<AvailabilityReason, TranslationKey> = {
  body: 'previewReasonBody', workspace: 'previewReasonWorkspace', story: 'previewReasonStory',
  trajectory: 'previewReasonTrajectory', catalog: 'previewReasonCatalog', spacecraft: 'previewReasonSpacecraft',
}

export function PreviewAvailability() {
  const state = availabilityStore.useStore()
  const { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (state.open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [state.open])
  if (PRODUCT_PROFILE !== 'preview') return null
  return <>
    <span id="preview-restriction-description" className="sr-only">{t('previewRestriction')}</span>
    <dialog ref={dialog} className="preview-availability" aria-labelledby="preview-title" aria-describedby="preview-description"
      onCancel={(event) => { event.preventDefault(); availabilityActions.dismiss() }}>
      <h2 id="preview-title">{state.denial ? t('fullVersion') : t('previewVersion')}</h2>
      <p id="preview-description">{state.denial ? t('previewRestriction') : t('previewExplanation')}</p>
      {state.denial && <p>{t(reasons[state.denial.reason])}</p>}
      <p>{t('previewDestinations')}</p>
      {state.requestedSceneUrl && <div className="preview-retained-scene">
        <label htmlFor="preview-requested-scene">{t('previewRetainedScene')}</label>
        <textarea id="preview-requested-scene" readOnly value={state.requestedSceneUrl} />
        <button type="button" className="quiet-button" onClick={async () => {
          try {
            await navigator.clipboard.writeText(state.requestedSceneUrl!)
            uiActions.toast(t('previewSceneCopied'))
          } catch { dialog.current?.querySelector('textarea')?.select() }
        }}>{t('previewCopyScene')}</button>
      </div>}
      <div className="preview-actions">
        <button type="button" className="primary-button" onClick={availabilityActions.explorePreview}>{t('previewExplore')}</button>
        <button type="button" className="quiet-button" onClick={availabilityActions.dismiss}>{t('dismiss')}</button>
      </div>
    </dialog>
  </>
}
