import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createKernelResolver, kernelsCoveringInterval, type LoadedKernel } from '../../src/engine/ephemeris/kernelPool'
import { SpkKernel } from '../../src/engine/ephemeris/spk'
import provenance from '../fixtures/jup347-himalia-join-provenance.json'
import reference from '../fixtures/jup347-himalia-join-cspice.json'

// Metadata-only fixtures: these tests do not assert numerical state accuracy.
const file = (ranges: [number, number, number][]): LoadedKernel => ({
  id: 'segmented',
  kernel: { segments: ranges.map(([target, startEt, endEt]) => ({ target, startEt, endEt })) } as LoadedKernel['kernel'],
})
describe('whole-window segmented SPK selection', () => {
  it('evaluates a real original forward/backward join against independent CSPICE states', () => {
    const load = (path: string, sha256: string) => {
      const bytes = readFileSync(path)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256)
      return bytes
    }
    load(`tests/fixtures/${provenance.reference}`, provenance.referenceSha256)
    load(provenance.oracleSource, provenance.oracleSourceSha256)
    const kernels = [
      ['core', load(`public/data/ephemerides/${provenance.core}`, provenance.coreSha256)],
      ['himalia', load(`tests/fixtures/${provenance.fixture}`, provenance.fixtureSha256)],
    ].map(([id, value]) => {
      const bytes = value as Buffer
      return { id: id as string, kernel: new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) }
    })
    const selected = kernelsCoveringInterval(kernels, reference.firstEt, reference.lastEt)
    expect(selected).toEqual(kernels)
    expect(kernels[1].kernel.segments).toHaveLength(2)
    expect(kernels[1].kernel.segments.map(segment => [segment.startEt, segment.endEt])).toEqual([
      [reference.firstEt, provenance.joinEtTdbSeconds], [provenance.joinEtTdbSeconds, reference.lastEt],
    ])
    const samples = [...reference.samples.map(sample => ({ et: sample.et, state: sample.barycentricEcliptic })), ...provenance.nearJoinBarycentricEcliptic]
    for (const sample of samples) {
      const state = createKernelResolver(selected, sample.et).barycentric(506)!
      expect(state).not.toBeNull()
      const values = [state.position.x, state.position.y, state.position.z, state.velocity.x, state.velocity.y, state.velocity.z]
      values.forEach((value, index) => expect(Math.abs(value - sample.state[index]), `ET ${sample.et}, component ${index}`).toBeLessThan(index < 3 ? 0.000002 : 1e-11))
    }
    expect(kernelsCoveringInterval([kernels[1]], reference.firstEt - 1, reference.lastEt)).toEqual([])
    expect(kernels[1].kernel.evaluate(506, reference.lastEt + 1)).toBeNull()
  })
  it('accepts original adjacent forward/backward segments as one fixed file', () => {
    const kernel = file([[506, 0, 20], [506, 20, 40]])
    expect(kernelsCoveringInterval([kernel], 10, 30)).toEqual([kernel])
    expect(kernelsCoveringInterval([kernel], 0, 40)).toEqual([kernel])
    expect(kernelsCoveringInterval([kernel], 20, 20)).toEqual([kernel])
    expect(kernel.kernel.segments.map(segment => segment.startEt)).toEqual([0, 20])
  })
  it('does not bridge gaps, extrapolate, or borrow another target coverage', () => {
    expect(kernelsCoveringInterval([file([[506, 0, 20], [506, 20.000001, 40]])], 10, 30)).toEqual([])
    expect(kernelsCoveringInterval([file([[506, 0, 20], [507, 20, 40]])], 10, 30)).toEqual([])
    expect(kernelsCoveringInterval([file([[506, 0, 40], [507, 0, 20]])], 10, 30)).toEqual([])
    expect(kernelsCoveringInterval([file([[506, 0, 40]])], -1, 30)).toEqual([])
    expect(kernelsCoveringInterval([file([[506, 0, 40]])], 10, 41)).toEqual([])
  })
  it('checks every target and preserves original segment precedence/order', () => {
    const kernel = file([[506, 20, 40], [507, 0, 50], [506, 0, 20], [506, 15, 25]])
    const original = [...kernel.kernel.segments]
    expect(kernelsCoveringInterval([kernel], 0, 40)).toEqual([kernel])
    expect(kernel.kernel.segments).toEqual(original)
    expect(kernelsCoveringInterval([kernel], NaN, 30)).toEqual([])
    expect(kernelsCoveringInterval([kernel], 30, 10)).toEqual([])
    expect(kernelsCoveringInterval([file([])], 0, 10)).toEqual([])
  })
})
