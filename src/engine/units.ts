export const AU_IN_KM = 149_597_870.7
export const SECONDS_PER_DAY = 86_400
export const SOLAR_GM_AU3_PER_DAY2 = 0.0002959122082855911

export function auPerDayToKmPerSecond(value: number) {
  return value * AU_IN_KM / SECONDS_PER_DAY
}
export function kmPerSecondToAuPerDay(value: number) {
  return value * SECONDS_PER_DAY / AU_IN_KM
}
