import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { majorBodiesById } from '../../src/data/majorBodies'
import { createAnalysisEphemeris, MissingPreciseStateError } from '../../src/engine/ephemeris/analysisEphemeris'
import { createKernelResolver } from '../../src/engine/ephemeris/kernelPool'
import { EPHEMERIS_MANIFEST } from '../../src/engine/ephemeris/kernelStore'
import { SpkKernel } from '../../src/engine/ephemeris/spk'
import { utcJulianDayToEt } from '../../src/engine/ephemeris/timeScales'
import { AU_IN_KM, SECONDS_PER_DAY } from '../../src/engine/units'
import { solveBodyToBodyLambert, computePorkchopGrid } from '../../src/engine/mission/lambert'
import type { CelestialBody } from '../../src/types'

const file = EPHEMERIS_MANIFEST.files.find(file => file.id.startsWith('de440s'))!
const bytes = readFileSync(`public/data/ephemerides/${file.path}`)
const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const pool = [{ id: file.id, kernel }]
const jd = 2461287.5
const create = (overrides: Partial<Parameters<typeof createAnalysisEphemeris>[0]> = {}) => createAnalysisEphemeris({
  bodiesById: majorBodiesById, kernels: pool, startJulianDay: jd - 10, endJulianDay: jd + 10,
  policy: 'require-spk', ...overrides,
})

describe('frozen analysis states and evidence', () => {
  it('uses the pinned original core and its same-evaluation position and velocity', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
    const analysis = create()
    const expected = createKernelResolver(pool, utcJulianDayToEt(jd)).relative(399, 10)!
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(analysis.at(jd).position('earth')[axis]).toBeCloseTo(expected.position[axis] / AU_IN_KM, 14)
      expect(analysis.at(jd).velocity('earth')[axis]).toBe(expected.velocity[axis] * (SECONDS_PER_DAY / AU_IN_KM))
    }
    expect(analysis.evidence()).toMatchObject({ frame: 'ECLIPJ2000', dynamicalTimeScale: 'TDB',
      // This fixture bypasses the loader; its separately checked bytes do not
      // create a loader-owned verification receipt for the analysis export.
      kernelPool: [{ id: file.id, sha256: null }], bodies: [{ bodyId: 'earth', model: 'jpl-spk' }] })
  })

  it('refuses missing precise coverage despite an available approximate orbit', () => {
    expect(() => create({ kernels: [] }).at(jd).position('earth')).toThrow(MissingPreciseStateError)
    const approximate = create({ kernels: [], policy: 'prefer-spk', needsVelocity: true })
    expect(Object.values(approximate.at(jd).position('earth')).every(Number.isFinite)).toBe(true)
    expect(Object.values(approximate.at(jd).velocity('earth')).every(Number.isFinite)).toBe(true)
    expect(approximate.bodyModels()).toMatchObject([{ bodyId: 'earth', model: 'approximate-fallback' }])
    // A heliocentric origin is geometry, never a fabricated Sun ephemeris.
    const strict = create({ kernels: [] })
    expect(strict.at(jd).position('sun')).toEqual({ x: 0, y: 0, z: 0 })
    expect(strict.bodyModels()).toMatchObject([{ bodyId: 'sun', model: 'heliocentric-origin' }])
  })

  it('uses the actual TDB duration for approximate velocities across a UTC leap second', () => {
    const center = 2457754.5 // 2017-01-01 00:00 UTC, immediately after the inserted leap second.
    const step = 0.01
    const before = center - step, after = center + step
    const analysis = create({ kernels: [], policy: 'prefer-spk', needsVelocity: true,
      startJulianDay: before, endJulianDay: after })
    const elapsedDays = (utcJulianDayToEt(after) - utcJulianDayToEt(before)) / SECONDS_PER_DAY
    expect(elapsedDays * SECONDS_PER_DAY).toBeCloseTo(1729, 4)
    const expectedBefore = analysis.at(before).position('earth')
    const expectedAfter = analysis.at(after).position('earth')
    const velocity = analysis.at(center).velocity('earth')
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(velocity[axis]).toBeCloseTo((expectedAfter[axis] - expectedBefore[axis]) / elapsedDays, 12)
    }
  })

  it('rejects a source that covers only part of the analysis window', () => {
    const range = kernel.segments[0]
    const narrowed = { ...pool[0], kernel: { segments: kernel.segments.map(segment => ({ ...segment, startEt: utcJulianDayToEt(jd), endEt: range.endEt })), evaluate: kernel.evaluate.bind(kernel) } as SpkKernel }
    expect(() => create({ kernels: [narrowed] }).at(jd).position('earth')).toThrow(MissingPreciseStateError)
  })

  it('reuses an epoch across repeated endpoint calls without unbounded retention', () => {
    const spy = vi.spyOn(kernel, 'evaluate')
    try {
      const analysis = create()
      analysis.at(jd).position('earth')
      const calls = spy.mock.calls.length
      analysis.at(jd).position('earth')
      analysis.at(jd).velocity('earth')
      expect(spy).toHaveBeenCalledTimes(calls)
      for (let index = 1; index <= 70; index++) analysis.at(jd + index / 100).position('earth')
      const before = spy.mock.calls.length
      analysis.at(jd).position('earth')
      expect(spy.mock.calls.length).toBeGreaterThan(before)
    } finally { spy.mockRestore() }
  })

  it('accounts for an inserted UTC leap second in dynamical flight time', () => {
    const first = 2457753.5, last = 2457754.5 // 2016-12-31 to 2017-01-01 UTC
    const analysis = create({ startJulianDay: first, endJulianDay: last })
    expect(analysis.elapsedDays(first, last) * SECONDS_PER_DAY).toBeCloseTo(86401, 3)
    expect(() => analysis.at(last + 1)).toThrow('outside')
    expect(() => analysis.elapsedDays(first - 1, last)).toThrow('analysis window')
  })

  it('preserves historical and future time-conversion limitations in evidence', () => {
    const old = create({ startJulianDay: 2400000, endJulianDay: 2400001, policy: 'prefer-spk' })
    expect(old.elapsedDays(2400000, 2400001)).toBe(1)
    expect(old.evidence()).toMatchObject({ dynamicalTimeScale: 'legacy-numeric-jd', timeScaleQuality: null })
    expect(create({ endJulianDay: 2465000 }).evidence().timeScaleQuality?.status).toBe('future-uncertain')
  })

  it('exports a strict SPK transfer with frozen endpoints and both actual state models', () => {
    const result = solveBodyToBodyLambert({ kernels: pool, ephemerisPolicy: 'require-spk', bodiesById: majorBodiesById,
      departureBodyId: 'earth', arrivalBodyId: 'venus', departureJulianDay: jd, arrivalJulianDay: jd + 120 })
    expect(result.converged).toBe(true)
    expect(result.endpoints).toEqual({ departureBodyId: 'earth', arrivalBodyId: 'venus', departureJulianDay: jd, arrivalJulianDay: jd + 120 })
    expect(result.ephemeris?.bodies.map(body => body.model)).toEqual(['jpl-spk', 'jpl-spk'])
    expect(result.departureVInfinityKmS).toBeGreaterThan(0)
  })

  it('fails a strict porkchop job when the frozen pool lacks a requested target', () => {
    const unknown: CelestialBody = { ...majorBodiesById.get('earth')!, id: 'no-spk', naifId: 123456789 }
    expect(() => computePorkchopGrid({ ephemerisFiles: [], ephemerisPolicy: 'require-spk',
      bodiesById: new Map([...majorBodiesById, [unknown.id, unknown]]), departureBodyId: 'no-spk', arrivalBodyId: 'venus',
      departureStartJd: jd, departureSpanDays: 30, minFlightDays: 100, maxFlightDays: 200, columns: 2, rows: 2 })).toThrow(MissingPreciseStateError)
  })
})
