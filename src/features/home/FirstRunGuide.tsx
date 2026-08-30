import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import {
  ONBOARDING_REQUEST_EVENT,
  activateOnboardingRenderer,
  hasCompletedOnboarding,
  markOnboardingComplete,
} from '../../lib/onboarding'

export function FirstRunGuide() {
  const { t } = useI18n()
  const [visible, setVisible] = useState(() => !hasCompletedOnboarding())
  const [mode, setMode] = useState<'choice' | 'tour'>('choice')
  const [step, setStep] = useState(0)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const tips = [t('onboardingDrag'), t('onboardingFrame'), t('onboardingSelect'), t('onboardingStory')]

  useEffect(() => {
    const open = () => {
      setMode('choice')
      setStep(0)
      setVisible(true)
    }
    window.addEventListener(ONBOARDING_REQUEST_EVENT, open)
    return () => window.removeEventListener(ONBOARDING_REQUEST_EVENT, open)
  }, [])

  useEffect(() => {
    if (!visible) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    window.requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }))
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      markOnboardingComplete()
      setVisible(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus({ preventScroll: true })
    }
  }, [visible])

  function complete() {
    markOnboardingComplete()
    setVisible(false)
  }

  if (!visible) return null
  if (mode === 'choice') return <div ref={dialogRef} tabIndex={-1} className="first-run-guide first-run-choice glass-panel" role="dialog" aria-labelledby="first-run-choice-title" aria-describedby="first-run-choice-description" aria-modal="false">
    <button className="first-run-close" onClick={() => complete()} aria-label={t('dismiss')}>×</button>
    <span className="eyebrow">{t('firstVisit')}</span>
    <h2 id="first-run-choice-title">{t('onboardingChoiceTitle')}</h2>
    <p id="first-run-choice-description">{t('onboardingChoiceDescription')}</p>
    <div className="first-run-choice-actions">
      <button className="primary-button" onClick={() => { activateOnboardingRenderer(); setMode('tour') }}>{t('startTutorial')} →</button>
      <button className="quiet-button" onClick={() => complete()}>{t('exploreIndependently')}</button>
    </div>
  </div>
  return <div ref={dialogRef} tabIndex={-1} className="first-run-guide glass-panel" role="dialog" aria-labelledby="first-run-title" aria-modal="false">
    <div className="first-run-progress" aria-hidden="true">{tips.map((_, index) => <i className={index === step ? 'active' : ''} key={index} />)}</div>
    <button className="first-run-close" onClick={() => complete()} aria-label={t('dismiss')}>×</button>
    <span className="eyebrow">{String(step + 1).padStart(2, '0')} / 04</span>
    <h2 id="first-run-title">{t('onboardingTitle')}</h2>
    <p>{tips[step]}</p>
    <div className="first-run-actions">
      {step > 0 && <button className="quiet-button" onClick={() => setStep((value) => value - 1)}>← {t('previousTip')}</button>}
      <button className="primary-button" onClick={() => step === tips.length - 1 ? complete() : setStep((value) => value + 1)}>
        {step === tips.length - 1 ? t('gotIt') : t('nextTip')} →
      </button>
    </div>
  </div>
}
