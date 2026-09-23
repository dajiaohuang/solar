/** IAU 2006 Resolution B3. Two-part dates avoid adding small corrections to
 * a large scalar JD. This converts time only, not catalog rates or distances. */
export const TCB_TDB_LB = 1.550519768e-8
const ORIGIN_DAY = 2443144.5, ORIGIN_FRACTION = 32.184/86400, TDB0_DAYS = -6.55e-5/86400
export type BarycentricJulianDate = { day: number; fraction: number }

function validate(date: BarycentricJulianDate) {
  if (!Number.isSafeInteger(date.day) || Math.abs(date.day) > 10_000_000 || !Number.isFinite(date.fraction) || date.fraction < 0 || date.fraction >= 1) throw new RangeError('Invalid canonical two-part barycentric Julian date')
}
function shifted(date: BarycentricJulianDate, offset: number): BarycentricJulianDate {
  const fraction = date.fraction+offset, carry = Math.floor(fraction)
  return {day:date.day+carry,fraction:fraction-carry}
}
export function tcbToTdb(date: BarycentricJulianDate): BarycentricJulianDate {
  validate(date)
  const elapsed = (date.day-ORIGIN_DAY)+(date.fraction-ORIGIN_FRACTION)
  return shifted(date,TDB0_DAYS-TCB_TDB_LB*elapsed)
}
export function tdbToTcb(date: BarycentricJulianDate): BarycentricJulianDate {
  validate(date)
  const elapsed = (date.day-ORIGIN_DAY)+(date.fraction-ORIGIN_FRACTION)
  return shifted(date,(TCB_TDB_LB*elapsed-TDB0_DAYS)/(1-TCB_TDB_LB))
}
