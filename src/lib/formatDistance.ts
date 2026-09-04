import { AU_IN_KM } from '../engine/units'

const INVALID = '—'

function formatter(locale?: string) {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 })
}

export function formatDistanceAU(distanceAU: number, locale?: string): string {
  if (!Number.isFinite(distanceAU) || distanceAU < 0) return INVALID
  const number = formatter(locale)
  return distanceAU < 0.01 ? `${number.format(distanceAU * AU_IN_KM)} km` : `${number.format(distanceAU)} AU`
}

export function formatPeriodDays(periodDays: number, locale?: string): string {
  if (!Number.isFinite(periodDays) || periodDays <= 0) return INVALID
  const number = formatter(locale)
  return periodDays < 1 ? `${number.format(periodDays * 24)} h` : `${number.format(periodDays)} d`
}
