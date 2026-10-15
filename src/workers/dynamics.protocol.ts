import { DE440_FORCE_IDS } from '../engine/dynamics/de440Source.ts'
import { trajectoryScanIntervals } from '../engine/events/trajectoryEvents.ts'

export type DynamicsRequest = {
  kind?: 'covariance' | 'ensemble' | 'ensemble-events'
  initialBytes: ArrayBuffer
  durationSeconds: number
  exclusionKm: number
  compareRefinement: boolean
  solarRelativity: boolean
  adoptSolarRadiationPressure?: boolean
  sampleCount?: number
  seed?: number
  eventSearch?: { targetNaifId: number; distanceKm: number; maxStepSeconds: number;
    toleranceSeconds: number; maxEvaluations: number; maxEvents: number }
}

export function dynamicsCalculation(request: Pick<DynamicsRequest, 'kind' | 'solarRelativity' | 'adoptSolarRadiationPressure'>) {
  if (request.kind === 'covariance') return 'conditional-six-parameter-de440-covariance'
  if (request.kind === 'ensemble') return 'conditional-six-parameter-de440-nonlinear-ensemble'
  if (request.kind === 'ensemble-events') return 'conditional-six-parameter-de440-distance-event-ensemble'
  if (request.adoptSolarRadiationPressure) return 'restricted-de440-radial-srp-experiment'
  return request.solarRelativity ? 'restricted-de440-solar-1pn-experiment' : 'restricted-newtonian-de440-experiment'
}

export function validateDynamicsRequest(request: DynamicsRequest) {
  if (!request || ![undefined, 'covariance', 'ensemble', 'ensemble-events'].includes(request.kind) ||
      !(request.initialBytes instanceof ArrayBuffer) || request.initialBytes.byteLength === 0 || request.initialBytes.byteLength > 2 * 1024 * 1024 ||
      !Number.isFinite(request.durationSeconds) || Math.abs(request.durationSeconds) > 365 * 86400 ||
      !Number.isFinite(request.exclusionKm) || request.exclusionKm < 0 ||
      typeof request.compareRefinement !== 'boolean' || typeof request.solarRelativity !== 'boolean' ||
      (request.adoptSolarRadiationPressure !== undefined && typeof request.adoptSolarRadiationPressure !== 'boolean')) throw new RangeError('Invalid bounded dynamics request')
  if (request.kind && request.adoptSolarRadiationPressure) throw new RangeError('Manual force adoption is unsupported for covariance and ensemble requests')
  if ((request.kind === 'ensemble' || request.kind === 'ensemble-events') && request.compareRefinement) throw new RangeError('Refinement is unsupported for ensemble requests')
  if (request.kind === 'ensemble' || request.kind === 'ensemble-events') {
    if (!Number.isSafeInteger(request.sampleCount) || request.sampleCount! < 1 || request.sampleCount! > 128 ||
        !Number.isSafeInteger(request.seed) || request.seed! < 0 || request.seed! > 0xffffffff) throw new RangeError('Ensemble requires 1 to 128 draws and an unsigned 32-bit seed')
  } else if (request.sampleCount !== undefined || request.seed !== undefined) throw new RangeError('Sampling settings require an ensemble request')
  if (request.kind === 'ensemble-events') {
    const search = request.eventSearch
    if (!search || !Number.isSafeInteger(search.targetNaifId) || !(DE440_FORCE_IDS as readonly number[]).includes(search.targetNaifId) ||
        !Number.isFinite(search.distanceKm) || search.distanceKm <= 0 ||
        !Number.isFinite(search.maxStepSeconds) || search.maxStepSeconds <= 0 ||
        !Number.isFinite(search.toleranceSeconds) || search.toleranceSeconds <= 0 || search.toleranceSeconds > search.maxStepSeconds ||
        !Number.isSafeInteger(search.maxEvaluations) || search.maxEvaluations < 1 || search.maxEvaluations > 2048 ||
        !Number.isSafeInteger(search.maxEvents) || search.maxEvents < 1 || search.maxEvents > 128 ||
        trajectoryScanIntervals(Math.abs(request.durationSeconds), search.maxStepSeconds,
          Math.min(0, request.durationSeconds), Math.max(0, request.durationSeconds), search.maxEvaluations) + 1 > search.maxEvaluations) {
      throw new RangeError('Invalid ensemble event search settings')
    }
  } else if (request.eventSearch !== undefined) throw new RangeError('Event search settings require an event ensemble request')
}
