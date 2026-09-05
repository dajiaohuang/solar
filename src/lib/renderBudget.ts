import type { RenderQuality } from '../types'

export type RenderViewMode = '2d' | '3d'
export type RenderDeviceClass = 'mobile' | 'desktop'
export type RenderCapacityTier = 'mobile-conservative' | 'mobile12' | 'desktop16' | 'desktop32'

export type RenderDeviceHints = {
  deviceMemoryGb?: number
  hardwareConcurrency?: number
}

export type RenderBudgetPolicy = {
  minimum: number
  initial: number
  maximum: number
  adaptive: boolean
}

export type AdaptiveRenderBudgetState = {
  count: number
  consecutiveSlowWindows: number
  consecutiveFastWindows: number
  lastAdjustmentAtMs: number | null
}

export type RenderPerformanceWindow = {
  nowMs: number
  p90FrameTimeMs: number
  longFrameRatio: number
  visible: boolean
  warmedUp: boolean
  samplingActive: boolean
}

export type SplitRenderBudget = {
  primary: number
  secondary: number
}

export const RENDER_BUDGET_QUANTUM = 5_000
export const RENDER_BUDGET_COOLDOWN_MS = 5_000
export const MAX_SOURCE_INVENTORY_ROWS = 1_567_193

export function classifyRenderDevice(viewportWidth: number, coarsePointer: boolean): RenderDeviceClass {
  return viewportWidth <= 800 || (coarsePointer && viewportWidth <= 1_180) ? 'mobile' : 'desktop'
}

export function classifyRenderCapacity(deviceClass: RenderDeviceClass, hints: RenderDeviceHints = {}): RenderCapacityTier {
  if (deviceClass === 'mobile') return hints.deviceMemoryGb !== undefined && hints.deviceMemoryGb <= 4 ? 'mobile-conservative' : 'mobile12'
  if ((hints.deviceMemoryGb !== undefined && hints.deviceMemoryGb >= 24) || (hints.hardwareConcurrency !== undefined && hints.hardwareConcurrency >= 16)) return 'desktop32'
  return 'desktop16'
}

const TWO_DIMENSIONAL_BUDGETS: Record<RenderCapacityTier, RenderBudgetPolicy> = {
  'mobile-conservative': { minimum: 8_000, initial: 8_000, maximum: 8_000, adaptive: false },
  mobile12: { minimum: 500_000, initial: 500_000, maximum: 500_000, adaptive: false },
  desktop16: { minimum: 1_250_000, initial: 1_250_000, maximum: 1_250_000, adaptive: false },
  desktop32: { minimum: MAX_SOURCE_INVENTORY_ROWS, initial: MAX_SOURCE_INVENTORY_ROWS, maximum: MAX_SOURCE_INVENTORY_ROWS, adaptive: false },
}

const THREE_DIMENSIONAL_BUDGETS: Record<RenderCapacityTier, Record<RenderQuality, RenderBudgetPolicy>> = {
  'mobile-conservative': {
    auto: { minimum: 2_000, initial: 4_000, maximum: 8_000, adaptive: true },
    balanced: { minimum: 4_000, initial: 4_000, maximum: 4_000, adaptive: false },
    max: { minimum: 2_000, initial: 6_000, maximum: 10_000, adaptive: true },
  },
  mobile12: {
    auto: { minimum: 25_000, initial: 100_000, maximum: 250_000, adaptive: true },
    balanced: { minimum: 75_000, initial: 75_000, maximum: 75_000, adaptive: false },
    max: { minimum: 25_000, initial: 150_000, maximum: 250_000, adaptive: true },
  },
  desktop16: {
    auto: { minimum: 50_000, initial: 250_000, maximum: 750_000, adaptive: true },
    balanced: { minimum: 250_000, initial: 250_000, maximum: 250_000, adaptive: false },
    max: { minimum: 50_000, initial: 500_000, maximum: 750_000, adaptive: true },
  },
  desktop32: {
    auto: { minimum: 100_000, initial: 500_000, maximum: MAX_SOURCE_INVENTORY_ROWS, adaptive: true },
    balanced: { minimum: 500_000, initial: 500_000, maximum: 500_000, adaptive: false },
    max: { minimum: 100_000, initial: 1_000_000, maximum: MAX_SOURCE_INVENTORY_ROWS, adaptive: true },
  },
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function quantizeDown(value: number) {
  return Math.floor(value / RENDER_BUDGET_QUANTUM) * RENDER_BUDGET_QUANTUM
}

function quantizeUp(value: number) {
  return Math.ceil(value / RENDER_BUDGET_QUANTUM) * RENDER_BUDGET_QUANTUM
}

export function resolveRenderBudgetPolicy(
  deviceClass: RenderDeviceClass,
  viewMode: RenderViewMode,
  quality: RenderQuality,
  hints: RenderDeviceHints = {},
): RenderBudgetPolicy {
  const tier = classifyRenderCapacity(deviceClass, hints)
  const policy = viewMode === '2d'
    ? TWO_DIMENSIONAL_BUDGETS[tier]
    : THREE_DIMENSIONAL_BUDGETS[tier][quality]
  return { ...policy }
}

/**
 * Capability hints may make the first frame more conservative, but never
 * promote a device above the policy chosen by the viewport/sample profile.
 * Runtime measurements remain authoritative after that first choice.
 */
export function selectInitialRenderBudget(policy: RenderBudgetPolicy, hints: RenderDeviceHints = {}) {
  const lowMemoryHint = hints.deviceMemoryGb !== undefined && hints.deviceMemoryGb <= 4
  const lowConcurrencyHint = hints.hardwareConcurrency !== undefined && hints.hardwareConcurrency <= 4
  if (!policy.adaptive || (!lowMemoryHint && !lowConcurrencyHint)) return policy.initial
  return clamp(quantizeDown(policy.initial * 0.75), policy.minimum, policy.maximum)
}

export function createAdaptiveRenderBudgetState(
  policy: RenderBudgetPolicy,
  hints: RenderDeviceHints = {},
): AdaptiveRenderBudgetState {
  return {
    count: selectInitialRenderBudget(policy, hints),
    consecutiveSlowWindows: 0,
    consecutiveFastWindows: 0,
    lastAdjustmentAtMs: null,
  }
}

export function advanceAdaptiveRenderBudget(
  state: AdaptiveRenderBudgetState,
  window: RenderPerformanceWindow,
  policy: RenderBudgetPolicy,
): AdaptiveRenderBudgetState {
  if (!policy.adaptive || !window.visible || !window.warmedUp || !window.samplingActive) return state
  if (
    state.lastAdjustmentAtMs !== null
    && window.nowMs - state.lastAdjustmentAtMs < RENDER_BUDGET_COOLDOWN_MS
  ) return state

  const slow = window.p90FrameTimeMs > 28 || window.longFrameRatio > 0.15
  const fast = window.p90FrameTimeMs < 18.5 && window.longFrameRatio < 0.05
  const consecutiveSlowWindows = slow ? state.consecutiveSlowWindows + 1 : 0
  const consecutiveFastWindows = fast ? state.consecutiveFastWindows + 1 : 0

  if (consecutiveSlowWindows >= 2 && state.count > policy.minimum) {
    return {
      count: clamp(quantizeDown(state.count * 0.75), policy.minimum, policy.maximum),
      consecutiveSlowWindows: 0,
      consecutiveFastWindows: 0,
      lastAdjustmentAtMs: window.nowMs,
    }
  }

  if (consecutiveFastWindows >= 4 && state.count < policy.maximum) {
    return {
      count: clamp(quantizeUp(state.count * 1.125), policy.minimum, policy.maximum),
      consecutiveSlowWindows: 0,
      consecutiveFastWindows: 0,
      lastAdjustmentAtMs: window.nowMs,
    }
  }

  return {
    ...state,
    consecutiveSlowWindows,
    consecutiveFastWindows,
  }
}

export function splitRenderBudget(total: number, comparisonEnabled: boolean): SplitRenderBudget {
  const available = Math.max(0, Math.floor(total))
  if (!comparisonEnabled) return { primary: quantizeDown(available), secondary: 0 }
  if (available < RENDER_BUDGET_QUANTUM * 2) {
    const sharedSmallSample = Math.floor(available / 2)
    return { primary: sharedSmallSample, secondary: sharedSmallSample }
  }
  const sharedPrefix = quantizeDown(available / 2)
  return { primary: sharedPrefix, secondary: sharedPrefix }
}
