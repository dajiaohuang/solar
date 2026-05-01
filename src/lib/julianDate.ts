export const J2000_JULIAN_DAY = 2451545
const UNIX_EPOCH_JULIAN_DAY = 2440587.5
const MILLISECONDS_PER_DAY = 86_400_000

export function dateToJulianDay(date: Date) {
  return date.getTime() / MILLISECONDS_PER_DAY + UNIX_EPOCH_JULIAN_DAY
}

export function todayJulianDay() {
  return dateToJulianDay(new Date())
}

export function julianDayToDate(julianDay: number) {
  return new Date((julianDay - UNIX_EPOCH_JULIAN_DAY) * MILLISECONDS_PER_DAY)
}

export function formatJulianDayAsDate(julianDay: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(julianDayToDate(julianDay))
}
