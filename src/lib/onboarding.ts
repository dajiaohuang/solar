export const ONBOARDING_REQUEST_EVENT = 'solar-atlas-onboarding-request'
export const ONBOARDING_RENDER_READY_EVENT = 'solar-atlas-onboarding-render-ready'
export const ONBOARDING_STORAGE_KEY = 'solar-atlas-first-run-v1'

let rendererActivated = false

export function hasCompletedOnboarding() {
  try { return localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'complete' } catch { return false }
}

export function isOnboardingRendererReady() {
  return rendererActivated || hasCompletedOnboarding()
}

export function activateOnboardingRenderer() {
  rendererActivated = true
  window.dispatchEvent(new Event(ONBOARDING_RENDER_READY_EVENT))
}

export function markOnboardingComplete() {
  try { localStorage.setItem(ONBOARDING_STORAGE_KEY, 'complete') } catch { /* Optional storage. */ }
  activateOnboardingRenderer()
}

export function requestOnboarding() {
  window.dispatchEvent(new Event(ONBOARDING_REQUEST_EVENT))
}
