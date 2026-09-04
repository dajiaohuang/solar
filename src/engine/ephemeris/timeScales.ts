/** SPICE-compatible UTC to ET/TDB helpers (numeric UTC Julian days). */
export const SECONDS_PER_DAY = 86_400
export const J2000_JULIAN_DAY = 2_451_545
export const SPEED_OF_LIGHT_KM_PER_SECOND = 299_792.458
const LSK_ENTRIES: readonly [string, number][] = [
  ['1972-01-01', 10], ['1972-07-01', 11], ['1973-01-01', 12], ['1974-01-01', 13],
  ['1975-01-01', 14], ['1976-01-01', 15], ['1977-01-01', 16], ['1978-01-01', 17],
  ['1979-01-01', 18], ['1980-01-01', 19], ['1981-07-01', 20], ['1982-07-01', 21],
  ['1983-07-01', 22], ['1985-07-01', 23], ['1988-01-01', 24], ['1990-01-01', 25],
  ['1991-01-01', 26], ['1992-07-01', 27], ['1993-07-01', 28], ['1994-01-01', 29],
  ['1996-01-01', 30], ['1997-07-01', 31], ['1999-01-01', 32], ['2006-01-01', 33],
  ['2009-01-01', 34], ['2012-07-01', 35], ['2015-07-01', 36], ['2017-01-01', 37],
]
const calendarJulianDay = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000 + 2_440_587.5
const LEAPS = LSK_ENTRIES.map(([date, value]) => [calendarJulianDay(date), value] as [number, number])
const SOURCES = ['https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/time.html', 'https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/deltet_c.html'] as const
export interface TimeScaleQuality { scale: 'TDB' | 'ET'; status: 'supported' | 'future-uncertain'; leapSeconds: number; assumptions: readonly string[]; sources: readonly string[] }
function finiteJd(jd: number) { if (!Number.isFinite(jd)) throw new RangeError('Julian day must be finite') }
function leapSecondsAt(jd: number) { if (jd < LEAPS[0][0]) throw new RangeError('UTC conversion supports 1972-01-01 onward'); let value = LEAPS[0][1]; for (const [date, seconds] of LEAPS) if (jd >= date) value = seconds; return value }
export function utcTimeScaleQuality(jd: number, scale: 'TDB' | 'ET' = 'TDB'): TimeScaleQuality { finiteJd(jd); const leapSeconds = leapSecondsAt(jd); const future = jd > LEAPS[LEAPS.length - 1][0]; return { scale, status: future ? 'future-uncertain' : 'supported', leapSeconds, assumptions: ['Numeric UTC Julian days cannot represent the UTC leap-second label itself.', ...(future ? ['Future leap seconds are unknown; the last NAIF value is held constant (explicit extrapolation).'] : []), 'TDB-TT uses the NAIF DELTET periodic approximation, not a full relativistic time ephemeris.'], sources: SOURCES } }
export function utcJulianDayToTdb(jd: number): number { finiteJd(jd); const deltaAt = leapSecondsAt(jd); const utcSeconds = (jd - J2000_JULIAN_DAY) * SECONDS_PER_DAY; const ttSeconds = utcSeconds + deltaAt + 32.184; const meanAnomaly = 6.239996 + 1.99096871e-7 * ttSeconds; const eccentricAnomaly = meanAnomaly + 1.671e-2 * Math.sin(meanAnomaly); const periodic = 1.657e-3 * Math.sin(eccentricAnomaly); const result = jd + (deltaAt + 32.184 + periodic) / SECONDS_PER_DAY; if (!Number.isFinite(result)) throw new RangeError('UTC to TDB conversion produced a non-finite result'); return result }
/** SPICE ET is TDB in this application. */
export const utcJulianDayToEt = utcJulianDayToTdb
