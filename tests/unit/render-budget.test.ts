import { describe, expect, it } from 'vitest'
import {
  RENDER_BUDGET_COOLDOWN_MS,
  advanceAdaptiveRenderBudget,
  classifyRenderCapacity,
  classifyRenderDevice,
  createAdaptiveRenderBudgetState,
  resolveRenderBudgetPolicy,
  selectInitialRenderBudget,
  splitRenderBudget,
  type AdaptiveRenderBudgetState,
  type RenderBudgetPolicy,
  type RenderPerformanceWindow,
} from '../../src/lib/renderBudget'

function performanceWindow(update: Partial<RenderPerformanceWindow> = {}): RenderPerformanceWindow {
  return {
    nowMs: 10_000,
    p90FrameTimeMs: 20,
    longFrameRatio: 0,
    visible: true,
    warmedUp: true,
    samplingActive: true,
    ...update,
  }
}

function advance(
  state: AdaptiveRenderBudgetState,
  policy: RenderBudgetPolicy,
  update: Partial<RenderPerformanceWindow>,
) {
  return advanceAdaptiveRenderBudget(state, performanceWindow(update), policy)
}

describe('render budget policies', () => {
  it('keeps coarse-pointer landscape phones on the mobile policy', () => {
    expect(classifyRenderDevice(390, true)).toBe('mobile')
    expect(classifyRenderDevice(915, true)).toBe('mobile')
    expect(classifyRenderDevice(1_280, true)).toBe('desktop')
    expect(classifyRenderDevice(1_024, false)).toBe('desktop')
  })

  it('uses larger fixed 2D ceilings for 12 GB mobile and 16 GB desktop tiers', () => {
    expect(resolveRenderBudgetPolicy('mobile', '2d', 'auto')).toEqual({
      minimum: 500_000, initial: 500_000, maximum: 500_000, adaptive: false,
    })
    expect(resolveRenderBudgetPolicy('desktop', '2d', 'max')).toEqual({
      minimum: 1_250_000, initial: 1_250_000, maximum: 1_250_000, adaptive: false,
    })
  })

  it('declares separate adaptive mobile, desktop 16 GB, and maximum 3D ranges', () => {
    expect(resolveRenderBudgetPolicy('mobile', '3d', 'auto')).toEqual({
      minimum: 25_000, initial: 100_000, maximum: 250_000, adaptive: true,
    })
    expect(resolveRenderBudgetPolicy('desktop', '3d', 'auto')).toEqual({
      minimum: 50_000, initial: 250_000, maximum: 750_000, adaptive: true,
    })
    expect(resolveRenderBudgetPolicy('desktop', '3d', 'max', { deviceMemoryGb: 32 })).toEqual({
      minimum: 100_000, initial: 1_000_000, maximum: 1_567_193, adaptive: true,
    })
  })

  it('selects capacity tiers conservatively and never promotes a low-memory phone', () => {
    expect(classifyRenderCapacity('mobile', { deviceMemoryGb: 4 })).toBe('mobile-conservative')
    expect(classifyRenderCapacity('mobile', { deviceMemoryGb: 12 })).toBe('mobile12')
    expect(classifyRenderCapacity('desktop', { deviceMemoryGb: 16, hardwareConcurrency: 8 })).toBe('desktop16')
    expect(classifyRenderCapacity('desktop', { deviceMemoryGb: 32 })).toBe('desktop32')
    const policy = resolveRenderBudgetPolicy('desktop', '3d', 'auto')
    expect(selectInitialRenderBudget(policy, { deviceMemoryGb: 16, hardwareConcurrency: 8 })).toBe(250_000)
    expect(selectInitialRenderBudget(policy, { deviceMemoryGb: 4 })).toBe(185_000)
    expect(selectInitialRenderBudget(policy, { hardwareConcurrency: 4 })).toBe(185_000)
    expect(selectInitialRenderBudget(resolveRenderBudgetPolicy('mobile', '2d', 'auto', { deviceMemoryGb: 4 }), {
      deviceMemoryGb: 2,
      hardwareConcurrency: 2,
    })).toBe(8_000)
  })
})

describe('adaptive render budget', () => {
  const policy = resolveRenderBudgetPolicy('desktop', '3d', 'auto')

  it('reduces by 25 percent after two consecutive slow windows', () => {
    let state = createAdaptiveRenderBudgetState(policy)
    state = advance(state, policy, { nowMs: 2_000, p90FrameTimeMs: 29 })
    expect(state.count).toBe(250_000)
    expect(state.consecutiveSlowWindows).toBe(1)
    state = advance(state, policy, { nowMs: 4_000, p90FrameTimeMs: 29 })
    expect(state.count).toBe(185_000)
    expect(state.lastAdjustmentAtMs).toBe(4_000)
  })

  it('also treats more than 15 percent long frames as slow', () => {
    let state = createAdaptiveRenderBudgetState(policy)
    state = advance(state, policy, { nowMs: 2_000, p90FrameTimeMs: 20, longFrameRatio: 0.16 })
    state = advance(state, policy, { nowMs: 4_000, p90FrameTimeMs: 20, longFrameRatio: 0.16 })
    expect(state.count).toBe(185_000)
  })

  it('increases by 12.5 percent after four consecutive fast windows', () => {
    let state = createAdaptiveRenderBudgetState(policy)
    for (let index = 1; index <= 4; index += 1) {
      state = advance(state, policy, {
        nowMs: index * 2_000,
        p90FrameTimeMs: 18,
        longFrameRatio: 0.04,
      })
    }
    expect(state.count).toBe(285_000)
    expect(state.lastAdjustmentAtMs).toBe(8_000)
  })

  it('uses strict frame thresholds and resets interrupted streaks', () => {
    let state = createAdaptiveRenderBudgetState(policy)
    state = advance(state, policy, { nowMs: 2_000, p90FrameTimeMs: 28, longFrameRatio: 0.15 })
    expect(state.consecutiveSlowWindows).toBe(0)
    state = advance(state, policy, { nowMs: 4_000, p90FrameTimeMs: 29 })
    state = advance(state, policy, { nowMs: 6_000, p90FrameTimeMs: 20 })
    expect(state.consecutiveSlowWindows).toBe(0)
    expect(state.count).toBe(250_000)

    for (let index = 0; index < 4; index += 1) {
      state = advance(state, policy, { nowMs: 8_000 + index * 2_000, p90FrameTimeMs: 18.5, longFrameRatio: 0.05 })
    }
    expect(state.count).toBe(250_000)
  })

  it('observes the five-second cooldown after an adjustment', () => {
    let state = createAdaptiveRenderBudgetState(policy)
    state = advance(state, policy, { nowMs: 2_000, p90FrameTimeMs: 29 })
    state = advance(state, policy, { nowMs: 4_000, p90FrameTimeMs: 29 })
    const adjusted = state
    state = advance(state, policy, {
      nowMs: 4_000 + RENDER_BUDGET_COOLDOWN_MS - 1,
      p90FrameTimeMs: 40,
      longFrameRatio: 1,
    })
    expect(state).toBe(adjusted)
    state = advance(state, policy, { nowMs: 9_000, p90FrameTimeMs: 40, longFrameRatio: 1 })
    expect(state.consecutiveSlowWindows).toBe(1)
  })

  it('does not sample while hidden, warming up, or paused', () => {
    const initial = createAdaptiveRenderBudgetState(policy)
    expect(advance(initial, policy, { visible: false, p90FrameTimeMs: 40 })).toBe(initial)
    expect(advance(initial, policy, { warmedUp: false, p90FrameTimeMs: 40 })).toBe(initial)
    expect(advance(initial, policy, { samplingActive: false, p90FrameTimeMs: 40 })).toBe(initial)
  })

  it('keeps all adjustments quantized and inside policy bounds', () => {
    let lowState: AdaptiveRenderBudgetState = {
      count: 55_000,
      consecutiveSlowWindows: 1,
      consecutiveFastWindows: 0,
      lastAdjustmentAtMs: null,
    }
    lowState = advance(lowState, policy, { p90FrameTimeMs: 40 })
    expect(lowState.count).toBe(50_000)

    const maxPolicy = resolveRenderBudgetPolicy('desktop', '3d', 'max')
    let highState: AdaptiveRenderBudgetState = {
      count: 745_000,
      consecutiveSlowWindows: 0,
      consecutiveFastWindows: 3,
      lastAdjustmentAtMs: null,
    }
    highState = advance(highState, maxPolicy, { p90FrameTimeMs: 10 })
    expect(highState.count).toBe(750_000)
  })

  it('does not adapt a balanced fixed policy', () => {
    const balanced = resolveRenderBudgetPolicy('desktop', '3d', 'balanced')
    const state = createAdaptiveRenderBudgetState(balanced)
    expect(advance(state, balanced, { p90FrameTimeMs: 50, longFrameRatio: 1 })).toBe(state)
  })
})

describe('comparison render budgets', () => {
  it('keeps the full budget for one frame and shares it across two frames', () => {
    expect(splitRenderBudget(250_000, false)).toEqual({ primary: 250_000, secondary: 0 })
    expect(splitRenderBudget(250_000, true)).toEqual({ primary: 125_000, secondary: 125_000 })
    expect(splitRenderBudget(255_000, true)).toEqual({ primary: 125_000, secondary: 125_000 })
  })

  it('normalizes arbitrary totals to the shared 5000-object quantum', () => {
    expect(splitRenderBudget(252_499, false)).toEqual({ primary: 250_000, secondary: 0 })
    const split = splitRenderBudget(252_499, true)
    expect(split).toEqual({ primary: 125_000, secondary: 125_000 })
    expect(split.primary + split.secondary).toBeLessThanOrEqual(252_499)
  })

  it('shows the same non-empty prefix in both frames for a small sample', () => {
    expect(splitRenderBudget(3, true)).toEqual({ primary: 1, secondary: 1 })
    expect(splitRenderBudget(1, true)).toEqual({ primary: 0, secondary: 0 })
  })
})
