export type HohmannResult = {
  semiMajorAxisAU: number
  eccentricity: number
  deltaV1: number
  deltaV2: number
  transferTimeDays: number
}

const SUN_GM = 0.000295912208

export function computeHohmann(
  aDepartAU: number,
  aArriveAU: number,
): HohmannResult | null {
  if (aDepartAU <= 0 || aArriveAU <= 0) {
    return null
  }

  const a1 = Math.min(aDepartAU, aArriveAU)
  const a2 = Math.max(aDepartAU, aArriveAU)
  const aTransfer = (a1 + a2) / 2
  const ecc = 1 - a1 / aTransfer

  const vDepart = Math.sqrt(SUN_GM / aDepartAU)
  const vTransferPeri = Math.sqrt(SUN_GM * (2 / a1 - 1 / aTransfer))
  const deltaV1 = Math.abs(vTransferPeri - vDepart)

  const vArrive = Math.sqrt(SUN_GM / aArriveAU)
  const vTransferApo = Math.sqrt(SUN_GM * (2 / a2 - 1 / aTransfer))
  const deltaV2 = Math.abs(vArrive - vTransferApo)

  const periodYears = Math.sqrt(aTransfer * aTransfer * aTransfer)
  const transferTimeDays = periodYears * 365.25 / 2

  return {
    semiMajorAxisAU: aTransfer,
    eccentricity: ecc,
    deltaV1,
    deltaV2,
    transferTimeDays,
  }
}
