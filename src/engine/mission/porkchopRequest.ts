import type { PorkchopWorkerRequest } from '../../workers/porkchop.worker'

export const PORKCHOP_GRID_COLUMNS = 26
export const PORKCHOP_GRID_ROWS = 22

/** Every UTC epoch sampled by the row-major Lambert grid, deduplicated and ordered. */
export function porkchopEndpointEpochs(params: {
  departureStartJd: number
  departureSpanDays: number
  minFlightDays: number
  maxFlightDays: number
  columns: number
  rows: number
}): number[] {
  if (![params.departureStartJd, params.departureSpanDays, params.minFlightDays, params.maxFlightDays].every(Number.isFinite) ||
      params.departureSpanDays < 0 || params.minFlightDays <= 0 || params.maxFlightDays < params.minFlightDays ||
      !Number.isFinite(params.departureStartJd + params.departureSpanDays + params.maxFlightDays) ||
      ![params.columns, params.rows].every(value => Number.isSafeInteger(value) && value >= 2 && value <= 60)) {
    throw new RangeError('Invalid Porkchop epoch grid')
  }
  const epochs = new Set<number>()
  for (let row = 0; row < params.rows; row++) {
    const flightDays = row === params.rows - 1 ? params.maxFlightDays : params.minFlightDays + row / (params.rows - 1) *
      (params.maxFlightDays - params.minFlightDays)
    for (let column = 0; column < params.columns; column++) {
      const departure = params.departureStartJd + column / (params.columns - 1) * params.departureSpanDays
      epochs.add(departure)
      epochs.add(departure + flightDays)
    }
  }
  return [...epochs].sort((a, b) => a - b)
}

/** Reject invalid jobs before fetching any requested SPK files. */
export function admitPorkchopRequest(request: PorkchopWorkerRequest): void {
  if (!Number.isSafeInteger(request.requestId) || request.requestId < 1) throw new RangeError('Invalid mission request identity')
  if (!['prefer-spk', 'require-spk'].includes(request.ephemerisPolicy ?? 'prefer-spk')) throw new RangeError('Unknown mission ephemeris policy')
  if (!Array.isArray(request.bodies)) throw new TypeError('Mission body descriptions are required')
  const ids = new Set<string>()
  for (const body of request.bodies) {
    if (!body || typeof body.id !== 'string' || !body.id || ids.has(body.id)) throw new RangeError('Mission body identities must be distinct')
    ids.add(body.id)
  }
  if (!ids.has(request.departureBodyId) || !ids.has(request.arrivalBodyId) || request.departureBodyId === request.arrivalBodyId) {
    throw new RangeError('Mission endpoints must be distinct known bodies')
  }
  const endDeparture = request.departureStartJd + request.departureSpanDays
  const endArrival = endDeparture + request.maxFlightDays
  if (![request.departureStartJd, request.departureSpanDays, request.minFlightDays, request.maxFlightDays, endDeparture, endArrival].every(Number.isFinite) ||
      request.departureSpanDays < 0 || request.minFlightDays <= 0 || request.maxFlightDays < request.minFlightDays ||
      request.departureStartJd + request.minFlightDays <= request.departureStartJd || endDeparture + request.minFlightDays <= endDeparture) {
    throw new RangeError('Mission dates and flight times must be finite, ordered and representably distinct')
  }
  if (request.ephemerisFiles !== undefined && (!Array.isArray(request.ephemerisFiles) ||
      request.ephemerisFiles.some(id => typeof id !== 'string' || !id) || new Set(request.ephemerisFiles).size !== request.ephemerisFiles.length)) {
    throw new RangeError('Mission ephemeris identities must be distinct nonempty strings')
  }
}
