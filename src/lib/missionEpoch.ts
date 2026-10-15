import { julianDayToDate } from './julianDate'

/** A precise UTC epoch is usable only with its matching visible calendar date. */
export function matchingMissionEpoch(value: unknown, date: string | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || !date) return undefined
  const instant = julianDayToDate(value)
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === date ? value : undefined
}
