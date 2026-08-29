import { describe, expect, it } from 'vitest'
import {
  RENDER_BUDGET_COOLDOWN_MS,
  advanceAdaptiveRenderBudget,
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

  it('uses separate fixed 2D ceilings for mobile and desktop', () => {
    expect(resolveRenderBudgetPolicy('mobile', '2d', 'auto')).toEqual({
      minimum: 8_000, initial: 8_000, maximum: 8_000, adaptive: false,
    })
    expect(resolveRenderBudgetPolicy('desktop', '2d', 'max')).toEqual({
      minimum: 30_000, initial: 30_000, maximum: 30_000, adaptive: false,
    })
  })

  it('declares the requested mobile, desktop, and maximum 3D ranges', () => {
    expect(resolveRenderBudgetPolicy('mobile', '3d', 'auto')).toEqual({
      minimum: 2_000, initial: 4_000, maximum: 6_000, adaptive: true,
    })
    expect(resolveRenderBudgetPolicy('desktop', '3d', 'auto')).toEqual({
      minimum: 6_000, initial: 12_000, maximum: 20_000, adaptive: true,
    })
    expect(resolveRenderBudgetPolicy('desktop', '3d', 'max')).toEqual({
      minimum: 8_000, initial: 20_000, maximum: 30_000, adaptive: true,
    })
  })

  it('uses capability hints only to choose a more conservative initial count', () => {
    const policy = resolveRenderBudgetPolicy('desktop', '3d', 'auto')
    expect(selectInitialRenderBudget(policy, { deviceMemoryGb: 32, hardwareConcurrency: 24 })).toBe(12_000)
    expect(selectInitialRenderBudget(policy, { deviceMemoryGb: 4 })).toBe(9_000)
    expect(selectInitialRenderBudget(policy, { hardwareConcurrency: 4 })).toBe(9_000)
    expect(selectInitialRenderBudget(resolveRenderBudgetPolicy('desktop', '2d', 'auto'), {
      deviceMemoryGb: 2,
      hardwareConcurrency: 2,
    })).toBe(30_000)
  })
})

describe('adaptive render budget', () => {
  const policy = resolveRenderBudgetPolicy('desktop', '3d', 'auto')

  it('reduces by 25 percent after two consecutive slow windows', () => {
    let state = createAdaptiveRenderBudgetState(policy)
    state = advance(state, policy, { nowMs: 2_000, p90FrameTimeMs: 29 })
    expect(state.count).toBe(12_000)
    expect(state.consecutiveSlowWindows).toBe(1)
    state = advance(state, policy, { nowMs: 4_000, p90FrameTimeMs: 29 })
    expect(state.count).toBe(9_000)
    expect(state.lastAdjustmentAtMs).toBe(4_000)
  })

  it('also treats more than 15 percent long frames as slow', () => {
    let state = createAdaptiveRenderBudgetState(policy)
    state = advance(state, policy, { nowMs: 2_000, p90FrameTimeMs: 20, longFrameRatio: 0.16 })
    state = advance(state, policy, { nowMs: 4_000, p90FrameTimeMs: 20, longFrameRatio: 0.16 })
    expect(state.count).toBe(9_000)
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
    expect(state.count).toBe(13_500)
    expect(state.lastAdjustmentAtMs).toBe(8_000)
  })

  it('uses strict frame thresholds and resets interrupted streaks', () => {
    let state = createAdaptiveRenderBudgetState(policy)
    state = advance(state, policy, { nowMs: 2_000, p90FrameTimeMs: 28, longFrameRatio: 0.15 })
    expect(state.consecutiveSlowWindows).toBe(0)
    state = advance(state, policy, { nowMs: 4_000, p90FrameTimeMs: 29 })
    state = advance(state, policy, { nowMs: 6_000, p90FrameTimeMs: 20 })
    expect(state.consecutiveSlowWindows).toBe(0)
    expect(state.count).toBe(12_000)

    for (let index = 0; index < 4; index += 1) {
      state = advance(state, policy, { nowMs: 8_000 + index * 2_000, p90FrameTimeMs: 18.5, longFrameRatio: 0.05 })
    }
    expect(state.count).toBe(12_000)
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
      count: 6_500,
      consecutiveSlowWindows: 1,
      consecutiveFastWindows: 0,
      lastAdjustmentAtMs: null,
    }
    lowState = advance(lowState, policy, { p90FrameTimeMs: 40 })
    expect(lowState.count).toBe(6_000)

    const maxPolicy = resolveRenderBudgetPolicy('desktop', '3d', 'max')
    let highState: AdaptiveRenderBudgetState = {
      count: 29_000,
      consecutiveSlowWindows: 0,
      consecutiveFastWindows: 3,
      lastAdjustmentAtMs: null,
    }
    highState = advance(highState, maxPolicy, { p90FrameTimeMs: 10 })
    expect(highState.count).toBe(30_000)
  })

  it('does not adapt a balanced fixed policy', () => {
    const balanced = resolveRenderBudgetPolicy('desktop', '3d', 'balanced')
    const state = createAdaptiveRenderBudgetState(balanced)
    expect(advance(state, balanced, { p90FrameTimeMs: 50, longFrameRatio: 1 })).toBe(state)
  })
})

describe('comparison render budgets', () => {
  it('keeps the full budget for one frame and shares it across two frames', () => {
    expect(splitRenderBudget(12_000, false)).toEqual({ primary: 12_000, secondary: 0 })
    expect(splitRenderBudget(12_000, true)).toEqual({ primary: 6_000, secondary: 6_000 })
    expect(splitRenderBudget(13_500, true)).toEqual({ primary: 6_500, secondary: 6_500 })
  })

  it('normalizes arbitrary totals to the shared 500-object quantum', () => {
    expect(splitRenderBudget(12_499, false)).toEqual({ primary: 12_000, secondary: 0 })
    const split = splitRenderBudget(12_499, true)
    expect(split).toEqual({ primary: 6_000, secondary: 6_000 })
    expect(split.primary + split.secondary).toBeLessThanOrEqual(12_499)
  })

  it('shows the same non-empty prefix in both frames for a small sample', () => {
    expect(splitRenderBudget(3, true)).toEqual({ primary: 1, secondary: 1 })
    expect(splitRenderBudget(1, true)).toEqual({ primary: 0, secondary: 0 })
  })
})
