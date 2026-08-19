import { julianDayToDate } from '../../lib/julianDate'

export const JPL_APPROX_VALID_FROM_YEAR = 1800
export const JPL_APPROX_VALID_TO_YEAR = 2050

export function jplApproxValidityWarning(julianDay: number, language: 'en' | 'zh' = 'en') {
  const year = julianDayToDate(julianDay).getUTCFullYear()
  if (year >= JPL_APPROX_VALID_FROM_YEAR && year <= JPL_APPROX_VALID_TO_YEAR) return null
  return language === 'zh'
    ? `当前日期 ${year} 超出 JPL 行星近似根数的 1800–2050 有效区间；位置仅作外推探索。`
    : `The year ${year} is outside the 1800–2050 validity interval of the JPL approximate planetary elements; positions are exploratory extrapolations.`
}

export function jplApproxWindowWarning(startJulianDay: number, endJulianDay: number, language: 'en' | 'zh' = 'en') {
  return jplApproxValidityWarning(startJulianDay, language) ?? jplApproxValidityWarning(endJulianDay, language)
}
