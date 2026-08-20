import { useState } from 'react'
import { useI18n } from '../../i18n/context'
import { uiActions } from '../../state/ui-store'

const STORAGE_KEY = 'solar-atlas-first-run-v1'

function wasCompleted() {
  try { return localStorage.getItem(STORAGE_KEY) === 'complete' } catch { return false }
}

export function FirstRunGuide() {
  const { t } = useI18n()
  const [visible, setVisible] = useState(() => !wasCompleted())
  const [step, setStep] = useState(0)
  const tips = [t('onboardingDrag'), t('onboardingFrame'), t('onboardingSelect'), t('onboardingStory')]

  function complete(openCoreCourse = false) {
    try { localStorage.setItem(STORAGE_KEY, 'complete') } catch { /* Optional storage. */ }
    setVisible(false)
    if (openCoreCourse) {
      uiActions.selectStory('geocentric-model', 0)
      uiActions.navigate('stories')
    }
  }

  if (!visible) return null
  return <aside className="first-run-guide glass-panel" role="dialog" aria-labelledby="first-run-title" aria-modal="false">
    <div className="first-run-progress" aria-hidden="true">{tips.map((_, index) => <i className={index === step ? 'active' : ''} key={index} />)}</div>
    <button className="first-run-close" onClick={() => complete()} aria-label={t('dismiss')}>×</button>
    <span className="eyebrow">{String(step + 1).padStart(2, '0')} / 04</span>
    <h2 id="first-run-title">{t('onboardingTitle')}</h2>
    <p>{tips[step]}</p>
    <div className="first-run-actions">
      {step > 0 && <button className="quiet-button" onClick={() => setStep((value) => value - 1)}>← {t('previousTip')}</button>}
      <button className="primary-button" onClick={() => step === tips.length - 1 ? complete(true) : setStep((value) => value + 1)}>
        {step === tips.length - 1 ? t('gotIt') : t('nextTip')} →
      </button>
    </div>
  </aside>
}
