import { describe, expect, it } from 'vitest'
import { advanceStateDisplayBudget, resetDisplayEvidence, selectStateDisplayPositions, StateDisplaySampler, type StateDisplayBudget } from '../../src/lib/stateDisplayBudget'
import { resolveRenderBudgetPolicy } from '../../src/lib/renderBudget'
import type { RenderedBodyPosition } from '../../src/types'

const initial = (): StateDisplayBudget => ({ count: 100_000, fast: 0, slow: 0, adjustedAt: null, reason: 'initial' })
const policy = resolveRenderBudgetPolicy('mobile', '3d', 'auto')
const fast = { samples: 60, p50Ms: 16, p95Ms: 16.7, missedRatio: 0 }
const slow = { ...fast, p95Ms: 22, missedRatio: .1 }

describe('exact-state display budget', () => {
  it('grows only after four exercised windows and honors cooldown', () => {
    let state = initial()
    for (let i = 0; i < 20; i++) state = advanceStateDisplayBudget(state, fast, policy, 293, i * 1000)
    expect(state.count).toBe(100_000)
    for (let i = 1; i <= 4; i++) state = advanceStateDisplayBudget(state, fast, policy, 100_000, i * 1000)
    expect(state.count).toBe(115_000)
    expect(advanceStateDisplayBudget(state, slow, policy, 200_000, 8999)).toBe(state)
    state = advanceStateDisplayBudget(state, slow, policy, 200_000, 9000)
    state = advanceStateDisplayBudget(state, slow, policy, 200_000, 10_000)
    expect(state.count).toBe(85_000)
  })
  it('decreases immediately on severe pressure and never escapes bounds', () => {
    let state = initial()
    for (let i = 0; i < 50; i++) state = advanceStateDisplayBudget(state, { ...slow, p95Ms: 40 }, policy, 300_000, i * 6000)
    expect(state.count).toBe(25_000)
    for (let i = 50; i < 550; i++) state = advanceStateDisplayBudget(state, fast, policy, 300_000, i * 6000)
    expect(state.count).toBe(250_000)
  })
  it('resets interrupted or invalid windows rather than carrying growth across them', () => {
    const state = { ...initial(), fast: 3, slow: 1 }
    expect(resetDisplayEvidence(state)).toEqual({ ...state, fast: 0, slow: 0 })
    for (const window of [{ ...fast, samples: 0 }, { ...fast, p95Ms: NaN }, { ...fast, missedRatio: Infinity }]) {
      expect(advanceStateDisplayBudget(state, window, policy, 300_000, 1000).fast).toBe(0)
    }
  })
  it('keeps 2D and 3D states independent; fixed quality can still lower under pressure', () => {
    const spatial = initial(), planar = { ...initial(), count: 250_000 }
    const reduced = advanceStateDisplayBudget(spatial, { ...slow, p95Ms: 50 }, policy, 300_000, 1000)
    expect(reduced.count).toBe(75_000); expect(planar.count).toBe(250_000)
    const fixed = { ...policy, adaptive: false }
    let state = initial()
    for (let i = 0; i < 10; i++) state = advanceStateDisplayBudget(state, fast, fixed, 300_000, i * 6000)
    expect(state.count).toBe(100_000)
    expect(advanceStateDisplayBudget(state, { ...slow, p95Ms: 50 }, fixed, 300_000, 80_000).count).toBe(75_000)
  })
})

describe('bounded renderer interval sampler', () => {
  it('discards warmup and measures p50/p95 and estimated missed frame slots', () => {
    const sampler = new StateDisplaySampler()
    expect(sampler.sample(1000)).toBeNull(); expect(sampler.sample(1000)).toBeNull()
    let result = null
    for (let i = 0; i < 30; i++) result = sampler.sample(34)
    expect(result).toEqual({ samples: 30, p50Ms: 34, p95Ms: 34, missedRatio: .5 })
    sampler.reset(); expect(sampler.sample(1000)).toBeNull()
  })
  it('caps storage at 120 samples even on unusually fast callbacks and resets invalid input', () => {
    const sampler = new StateDisplaySampler()
    let result = null
    for (let i = 0; i < 122; i++) result = sampler.sample(1)
    expect(result?.samples).toBe(120)
    expect(sampler.sample(NaN)).toBeNull()
    expect(sampler.sample(1000)).toBeNull(); expect(sampler.sample(1000)).toBeNull()
  })
})

describe('display-only source prefix', () => {
  const source = Array.from({ length: 10 }, (_, i) => ({ body: { id: `body-${i}` }, distance: i, planarPosition: { x: i, y: i }, position3D: { x: 1e12 + i, y: i, z: i } })) as RenderedBodyPosition[]
  it('keeps priority rows and deterministic source order without mutating scientific objects', () => {
    const before = structuredClone(source)
    const displayed = selectStateDisplayPositions(source, 4, ['body-8', 'body-6', 'missing'])
    expect(displayed.map(row => row.body.id)).toEqual(['body-6', 'body-8', 'body-0', 'body-1'])
    expect(displayed[0]).toBe(source[6]); expect(source).toEqual(before)
    expect(selectStateDisplayPositions(source, 10, [])).toBe(source)
    expect(selectStateDisplayPositions(source, 0, [])).toEqual([])
    expect(() => selectStateDisplayPositions(source, -1, [])).toThrow()
  })
  it('shares a capacity limit rather than halving a small available sample', () => {
    const perPane = Math.floor(100_000 / 2)
    const otherFrame = source.map(row => ({ ...row, position3D: { x: row.position3D!.x - 2, y: 0, z: 0 } }))
    expect(selectStateDisplayPositions(source, perPane, []).length).toBe(10)
    expect(selectStateDisplayPositions(otherFrame, 4, ['body-6']).map(row => row.body.id))
      .toEqual(selectStateDisplayPositions(source, 4, ['body-6']).map(row => row.body.id))
  })
})
