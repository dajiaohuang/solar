export type PorkchopWindow = {
  departureStartJd: number
  departureSpanDays: number
  minFlightDays: number
  maxFlightDays: number
  propagationStartJd: number
  propagationEndJd: number
}

export function createPorkchopWindow(
  departureJd: number,
  arrivalJd: number,
  hohmannTimeDays?: number,
): PorkchopWindow {
  const transferDays = hohmannTimeDays ?? Math.max(60, arrivalJd - departureJd)
  const departureStartJd = departureJd - 180
  const departureSpanDays = 365
  const minFlightDays = Math.max(30, transferDays * 0.55)
  const maxFlightDays = transferDays * 1.65
  return {
    departureStartJd,
    departureSpanDays,
    minFlightDays,
    maxFlightDays,
    propagationStartJd: departureStartJd,
    propagationEndJd: departureStartJd + departureSpanDays + maxFlightDays,
  }
}
