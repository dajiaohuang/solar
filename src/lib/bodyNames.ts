import { BODY_ENGLISH_NAMES } from '../data/physical'
import type { CelestialBody } from '../types'

export function bodyDisplayName(body: CelestialBody, language: 'zh' | 'en') {
  if (language === 'zh') return body.name
  return body.shortName || BODY_ENGLISH_NAMES[body.id] || body.name
}
