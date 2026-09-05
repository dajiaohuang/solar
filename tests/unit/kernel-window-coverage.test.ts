import { describe, expect, it } from 'vitest'
import { analyzeKernelWindow } from '../../scripts/lib/kernel-window-coverage.mjs'

type Kernel = { id: string; dependencyOnly?: boolean; solutionKernelIds?: string[]; segments: ReturnType<typeof seg>[] }
const seg = (target: number, center = 0, startEt = 0, endEt = 10, extra: Record<string, number> = {}) => ({ target, center, frame: 1, type: 2, startEt, endEt, ...extra })
const run = (kernels: Kernel[], target = 5, startEt = 0, endEt = 10) => analyzeKernelWindow({ kernels, target, startEt, endEt })

describe('kernel window descriptor coverage', () => {
  it('covers target 0 as the fixed zero origin, including a point window', () => {
    const result = run([], 0, 4, 4)
    expect(result.dependencyCoverage.points).toMatchObject([{ et: 4, state: 'covered' }])
    expect(result.gaps).toEqual([])
  })

  it('splits adjacent segments without hiding the boundary or gap', () => {
    const result = run([{ id: 'k', segments: [seg(5, 0, 0, 5), seg(5, 0, 5, 10)] }])
    expect(result.dependencyCoverage.intervals.map(x => [x.startEt, x.endEt, x.state])).toEqual([[0, 5, 'covered'], [5, 10, 'covered']])
    expect(result.dependencyCoverage.points.find(x => x.et === 5)?.state).toBe('covered')
  })

  it('ignores unrelated segment boundaries while including possible center switches', () => {
    const base = [{ id: 'k', segments: [seg(5, 1, 0, 5), seg(5, 2, 5, 10), seg(1, 0), seg(2, 0)] }]
    const noisy = [...base, { id: 'unrelated', segments: [seg(900, 0, 1, 2), seg(900, 0, 3, 4), seg(901, 0, 6, 7)] }]
    const clean = run(base), expanded = run(noisy)
    expect(expanded.dependencyCoverage.points.map(x => x.et)).toEqual(clean.dependencyCoverage.points.map(x => x.et))
    expect(clean.dependencyCoverage.points.map(x => x.et)).toEqual([0, 5, 10])
    expect(clean.dependencyCoverage.intervals.every(x => x.state === 'covered')).toBe(true)
  })

  it('reports an internal gap instead of using min/max', () => {
    const result = run([{ id: 'k', segments: [seg(5, 0, 0, 3), seg(5, 0, 7, 10)] }])
    expect(result.gaps.some(x => x.kind === 'interval' && x.startEt === 3 && x.endEt === 7)).toBe(true)
  })

  it('intersects center availability and preserves unavailable endpoints', () => {
    const result = run([{ id: 'k', segments: [seg(5, 7, 0, 100), seg(7, 0, 20, 80)] }], 5, 0, 100)
    expect(result.dependencyCoverage.intervals.map(x => [x.startEt, x.endEt, x.state])).toEqual([
      [0, 20, 'gap'], [20, 80, 'covered'], [80, 100, 'gap'],
    ])
    expect(result.dependencyCoverage.points.map(x => [x.et, x.state])).toEqual([[0, 'gap'], [20, 'covered'], [80, 'covered'], [100, 'gap']])
  })

  it('does not let an unsupported boundary point contaminate either open interval', () => {
    const result = run([{ id: 'k', segments: [seg(5), seg(5, 0, 5, 5, { frame: 99 })] }])
    expect(result.gaps).toMatchObject([{ kind: 'point', et: 5, reason: 'unsupported-selected-segment' }])
    expect(result.dependencyCoverage.intervals.every(x => x.state === 'covered')).toBe(true)
  })

  it('classifies open intervals without midpoint overflow or rounding to a closed endpoint', () => {
    const large = run([{ id: 'k', segments: [seg(5, 0, -Number.MAX_VALUE, Number.MAX_VALUE)] }], 5, -Number.MAX_VALUE, Number.MAX_VALUE)
    expect(large.gaps).toEqual([])
    const end = 1 + Number.EPSILON
    const adjacent = run([{ id: 'k', segments: [seg(5, 0, 1, end), seg(5, 0, 1, 1, { type: 99 })] }], 5, 1, end)
    expect(adjacent.gaps).toMatchObject([{ kind: 'point', et: 1 }])
    expect(adjacent.dependencyCoverage.intervals[0].state).toBe('covered')
  })

  it('rejects excessive boundaries, unsafe IDs and duplicate solution entries', () => {
    const segments = Array.from({ length: 4097 }, (_, i) => seg(5, 0, i, i + 1))
    expect(() => run([{ id: 'k', segments }], 5, 0, 4097)).toThrow('too many boundaries')
    expect(() => run([], Number.MAX_SAFE_INTEGER + 1)).toThrow()
    expect(() => run([{ id: 'k', segments: [seg(5)], solutionKernelIds: ['d', 'd'] }])).toThrow('invalid solution pool')
    expect(() => run([{ id: 'k', segments: [seg(5, Number.MAX_SAFE_INTEGER + 1)] }])).toThrow('invalid segment')
  })

  it('applies reverse kernel and segment precedence, with unsupported winner masking fallback', () => {
    const result = run([{ id: 'old', segments: [seg(5)] }, { id: 'new', segments: [seg(5, 0, 0, 10, { type: 99 })] }])
    expect(result.dependencyCoverage.points[0]).toMatchObject({ state: 'gap', reason: 'unsupported-selected-segment' })
    expect(result.dependencyCoverage.intervals[0]).toMatchObject({ state: 'gap', reason: 'unsupported-selected-segment' })
  })

  it('uses one explicit solution pool for the entire center chain', () => {
    const result = run([
      { id: 'dependency', dependencyOnly: true, segments: [seg(7)] },
      { id: 'root', solutionKernelIds: ['dependency'], segments: [seg(5, 7)] },
      { id: 'other', segments: [seg(7, 0)] },
    ])
    expect(result.dependencyCoverage.intervals[0]).toMatchObject({ state: 'covered' })
    expect(result.dependencyCoverage.intervals[0].chain.map(x => x.kernelId ?? x.origin)).toEqual(['root', 'dependency', 'naif:0'])
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
