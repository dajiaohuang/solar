export const ONBOARDING_REQUEST_EVENT = 'solar-atlas-onboarding-request'

export function requestOnboarding() {
  window.dispatchEvent(new Event(ONBOARDING_REQUEST_EVENT))
}
