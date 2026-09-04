import { describe, expect, it } from 'vitest'
import { createKernelResolver, kernelsCoveringInterval, type LoadedKernel } from '../../src/engine/ephemeris/kernelPool'

// Deliberately distinguish position and velocity in metadata-only test kernels.
function kernel(id: string, states: [number, number, number][], extra: Partial<LoadedKernel> = {}): LoadedKernel {
  return { id, ...extra, kernel: {
    segments: states.map(([target]) => ({ target, startEt: 0, endEt: 100 })),
    evaluate: (target: number, et: number) => {
      const state = states.find(row => row[0] === target)
      return !state || et < 0 || et > 100 ? null : { center: state[1], frame: 17, position: { x: state[2], y: 0, z: 0 }, velocity: { x: state[2] / 10, y: 0, z: 0 } }
    },
  } as LoadedKernel['kernel'] }
}
const legacy = kernel('de440', [[5, 0, 100], [10, 0, 10]])
const newer = kernel('de442', [[5, 0, 200], [10, 0, 20]], { dependencyOnly: true })
const oldMoon = kernel('old-moon', [[501, 5, 1]])
const newMoon = kernel('new-moon', [[506, 5, 2]], { solutionKernelIds: ['de442'] })

describe('explicit per-body SPK solution pools', () => {
  it('isolates both center and Sun from unrelated load order', () => {
    for (const pool of [[legacy, oldMoon, newer, newMoon], [newMoon, newer, oldMoon, legacy]]) {
      const resolver = createKernelResolver(pool, 50)
      expect(resolver.barycentric(501)?.position.x).toBe(101)
      expect(resolver.barycentric(506)?.position.x).toBe(202)
      expect(resolver.relative(501, 10)?.position.x).toBe(91)
      expect(resolver.relative(506, 10)?.position.x).toBe(182)
      expect(resolver.relative(506, 10)?.velocity.x).toBeCloseTo(18.2)
      expect(resolver.relative(506, 5)?.position.x).toBe(2)
    }
  })
  it('does not borrow a legacy center when an explicit dependency is absent or incomplete', () => {
    expect(createKernelResolver([legacy, newMoon], 50).barycentric(506)).toBeNull()
    const incomplete = kernel('de442', [[10, 0, 20]], { dependencyOnly: true })
    expect(createKernelResolver([legacy, incomplete, newMoon], 50).barycentric(506)).toBeNull()
    const short = kernel('de442', [[5, 0, 200]], { dependencyOnly: true })
    short.kernel.segments[0].endEt = 40
    expect(createKernelResolver(kernelsCoveringInterval([legacy, short, newMoon], 20, 60), 30).barycentric(506)).toBeNull()
  })
  it('uses an independent observer only when it is not represented in the target pool', () => {
    const observer = kernel('observer', [[599, 5, 5]])
    const resolver = createKernelResolver([legacy, newer, newMoon, observer], 50)
    expect(resolver.relative(506, 599)?.position.x).toBe(97)
    expect(resolver.relative(506, 0)?.position.x).toBe(202)
  })
  it('rejects malformed dependency identities rather than relying on array accidents', () => {
    expect(() => createKernelResolver([legacy, legacy], 50)).toThrow('Duplicate')
    expect(() => createKernelResolver([kernel('bad', [[506, 5, 2]], { solutionKernelIds: ['bad'] })], 50).barycentric(506)).toThrow('Invalid')
  })
})
