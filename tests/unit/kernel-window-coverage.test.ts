import { describe, expect, it } from 'vitest'
import { analyzeKernelWindow } from '../../scripts/lib/kernel-window-coverage.mjs'

type Kernel = { id: string; dependencyOnly?: boolean; solutionKernelIds?: string[]; segments: ReturnType<typeof seg>[] }
const seg = (target: number, center = 0, startEt = 0, endEt = 10, extra: Record<string, number> = {}) => ({ target, center, frame: 1, type: 2, startEt, endEt, ...extra })
const run = (kernels: Kernel[], target = 5, startEt = 0, endEt = 10) => analyzeKernelWindow({ kernels, target, startEt, endEt })

describe('kernel window descriptor coverage', () => {
  it('covers target 0 as the fixed zero origin, including a point window', () => {
    const result = run([], 0, 4, 4)
    expect(result.descriptorCoverage.points).toMatchObject([{ et: 4, state: 'covered' }])
    expect(result.gaps).toEqual([])
  })

  it('splits adjacent segments without hiding the boundary or gap', () => {
    const result = run([{ id: 'k', segments: [seg(5, 0, 0, 5), seg(5, 0, 5, 10)] }])
    expect(result.descriptorCoverage.intervals.map(x => [x.startEt, x.endEt, x.state])).toEqual([[0, 5, 'covered'], [5, 10, 'covered']])
    expect(result.descriptorCoverage.points.find(x => x.et === 5)?.state).toBe('covered')
  })

  it('ignores unrelated segment boundaries while including possible center switches', () => {
    const base = [{ id: 'k', segments: [seg(5, 1, 0, 5), seg(5, 2, 5, 10), seg(1, 0), seg(2, 0)] }]
    const noisy = [...base, { id: 'unrelated', segments: [seg(900, 0, 1, 2), seg(900, 0, 3, 4), seg(901, 0, 6, 7)] }]
    const clean = run(base), expanded = run(noisy)
    expect(expanded.descriptorCoverage.points.map(x => x.et)).toEqual(clean.descriptorCoverage.points.map(x => x.et))
    expect(clean.descriptorCoverage.points.map(x => x.et)).toEqual([0, 5, 10])
    expect(clean.descriptorCoverage.intervals.every(x => x.state === 'covered')).toBe(true)
  })

  it('reports an internal gap instead of using min/max', () => {
    const result = run([{ id: 'k', segments: [seg(5, 0, 0, 3), seg(5, 0, 7, 10)] }])
    expect(result.gaps.some(x => x.kind === 'interval' && x.startEt === 3 && x.endEt === 7)).toBe(true)
  })

  it('applies reverse kernel and segment precedence, with unsupported winner masking fallback', () => {
    const result = run([{ id: 'old', segments: [seg(5)] }, { id: 'new', segments: [seg(5, 0, 0, 10, { type: 99 })] }])
    expect(result.descriptorCoverage.points[0]).toMatchObject({ state: 'gap', reason: 'unsupported-selected-segment' })
    expect(result.descriptorCoverage.intervals[0]).toMatchObject({ state: 'gap', reason: 'unsupported-selected-segment' })
  })

  it('uses one explicit solution pool for the entire center chain', () => {
    const result = run([
      { id: 'dependency', dependencyOnly: true, segments: [seg(7)] },
      { id: 'root', solutionKernelIds: ['dependency'], segments: [seg(5, 7)] },
      { id: 'other', segments: [seg(7, 0)] },
    ])
    expect(result.descriptorCoverage.intervals[0]).toMatchObject({ state: 'covered' })
    expect(result.descriptorCoverage.intervals[0].chain.map(x => x.kernelId ?? x.origin)).toEqual(['root', 'dependency', 'naif:0'])
  })

  it('fails closed for missing explicit pools and missing centers', () => {
    expect(run([{ id: 'root', solutionKernelIds: ['missing'], segments: [seg(5)] }]).gaps[0].reason).toBe('explicit-solution-pool-missing')
    expect(run([{ id: 'k', segments: [seg(5, 9)] }]).gaps[0].reason).toBe('target-absent-in-solution-pool')
  })

  it('reports cycles and excessive center depth', () => {
    const cycle = run([{ id: 'k', segments: [seg(5, 6), seg(6, 5)] }])
    expect(cycle.gaps.some(x => x.reason === 'center-chain-cycle')).toBe(true)
    const deep = Array.from({ length: 34 }, (_, i) => ({ id: `k${i}`, segments: [seg(i + 1, i + 2)] }))
    deep.push({ id: 'k34', segments: [seg(35, 0)] })
    expect(run(deep, 1).gaps.some(x => x.reason === 'center-chain-depth-exceeded')).toBe(true)
  })

  it('rejects nonfinite and reversed numeric windows', () => {
    expect(() => run([{ id: 'k', segments: [] }], 5, Number.NaN, 1)).toThrow('finite ordered window')
    expect(() => run([{ id: 'k', segments: [] }], 5, 2, 1)).toThrow('finite ordered window')
    expect(() => run([{ id: 'k', segments: [seg(5, 0, 4, Number.POSITIVE_INFINITY)] }])).toThrow('invalid segment')
  })
})
