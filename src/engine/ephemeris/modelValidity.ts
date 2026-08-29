import { julianDayToDate } from '../../lib/julianDate'
import modelEvidence from '../../data/modelEvidence.json'

export const JPL_APPROX_MODEL_EVIDENCE = modelEvidence.planetaryApproximation
export const JPL_APPROX_VALID_FROM_YEAR = Number(JPL_APPROX_MODEL_EVIDENCE.validFrom.slice(0, 4))
export const JPL_APPROX_VALID_TO_YEAR = Number(JPL_APPROX_MODEL_EVIDENCE.validTo.slice(0, 4))
export const JPL_APPROX_VALIDITY_LABEL = `${JPL_APPROX_VALID_FROM_YEAR}–${JPL_APPROX_VALID_TO_YEAR}`

export function jplApproxValidityState(julianDay: number) {
  const year = julianDayToDate(julianDay).getUTCFullYear()
  return year >= JPL_APPROX_VALID_FROM_YEAR && year <= JPL_APPROX_VALID_TO_YEAR
    ? 'within-validity'
    : 'extrapolated'
}

export function jplApproxValidityWarning(julianDay: number, language: 'en' | 'zh' = 'en') {
  const year = julianDayToDate(julianDay).getUTCFullYear()
  if (jplApproxValidityState(julianDay) === 'within-validity') return null
  return language === 'zh'
    ? `当前日期 ${year} 超出 JPL 行星近似根数的 ${JPL_APPROX_VALIDITY_LABEL} 有效区间；位置仅作外推探索。`
    : `The year ${year} is outside the ${JPL_APPROX_VALIDITY_LABEL} validity interval of the JPL approximate planetary elements; positions are exploratory extrapolations.`
}

export function jplApproxWindowState(startJulianDay: number, endJulianDay: number) {
  return jplApproxValidityState(startJulianDay) === 'extrapolated'
    || jplApproxValidityState(endJulianDay) === 'extrapolated'
    ? 'extrapolated'
    : 'within-validity'
}

export function jplApproxWindowWarning(startJulianDay: number, endJulianDay: number, language: 'en' | 'zh' = 'en') {
  return jplApproxValidityWarning(startJulianDay, language) ?? jplApproxValidityWarning(endJulianDay, language)
}
