import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { majorBodies, majorBodiesById } from '../../src/data/majorBodies'
import seeds from '../../src/data/ephemerisBodies.json'
import { bodyNaifId } from '../../src/data/ephemerisTargets'
import { EPHEMERIS_MANIFEST, installKernel, kernelCoverage, kernelStateForBody, kernelsForWindow, loadedKernels } from '../../src/engine/ephemeris/kernelStore'
import { createKernelResolver } from '../../src/engine/ephemeris/kernelPool'
import { currentObservation, currentOsculatingElements } from '../../src/engine/ephemeris/diagnostics'
import { utcJulianDayToEt } from '../../src/engine/ephemeris/timeScales'
import { AU_IN_KM, SECONDS_PER_DAY } from '../../src/engine/units'
import { createBodyPositionResolver, createBodyVelocityResolver } from '../../src/lib/ephemeris'

const jd = 2461287.5
const body = (id: string) => majorBodiesById.get(id)!
beforeAll(() => {
  for (const file of EPHEMERIS_MANIFEST.files) {
    const bytes = readFileSync(`public/data/ephemerides/${file.path}`)
    installKernel(file.id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  }
})

describe('shared physical ephemeris integration', () => {
  it('covers 63 actual selectable body centers, not mislabeled planetary barycenters', () => {
    expect(majorBodies.filter((entry) => kernelCoverage(entry, jd).model === 'jpl-spk')).toHaveLength(63)
    expect(kernelCoverage(body('eris'), jd).model).toBe('approximate-fallback')
    const pool = createKernelResolver(loadedKernels(), utcJulianDayToEt(jd))
    const mars = kernelStateForBody(body('mars'), jd)!
    expect(mars).toEqual(pool.relative(499, 10))
    expect(mars).not.toEqual(pool.relative(4, 10))
  })

  it('matches newly generated states against the actual packaged center chains', () => {
    const pool = createKernelResolver(loadedKernels(), (seeds.epochJd - 2451545) * SECONDS_PER_DAY)
    for (const entry of seeds.bodies) {
      const parentId = bodyNaifId(body(entry.parentId))!
      const actual = pool.relative(entry.naifId, parentId)!
      const expected = entry.parentRelativeStateKm
      expect(Math.hypot(actual.position.x - expected.position.x, actual.position.y - expected.position.y, actual.position.z - expected.position.z), entry.id).toBeLessThan(1e-4)
    }
  })

  it('returns shared resolver positions and analytic SPK velocities in app units', () => {
    for (const id of ['earth', 'moon', 'mars', 'naif:401', 'jupiter', 'io', 'ceres', 'asteroid:2']) {
      const state = kernelStateForBody(body(id), jd)!
      const position = createBodyPositionResolver(majorBodiesById, jd)(id)
      const velocity = createBodyVelocityResolver(majorBodiesById, jd)(id)
      expect(position.x * AU_IN_KM).toBeCloseTo(state.position.x, 5)
      expect(velocity.x * AU_IN_KM / SECONDS_PER_DAY).toBeCloseTo(state.velocity.x, 10)
    }
  })

  it('does not extrapolate SPK or switch partially covered files inside a scan', () => {
    const core = EPHEMERIS_MANIFEST.files.find((file) => file.id.startsWith('de440s'))!
    const pool = createKernelResolver(loadedKernels(), core.endEt + 1)
    expect(pool.relative(399, 10)).toBeNull()
    const whole = kernelsForWindow(2458849.5 - 1, jd)
    expect(whole.map((kernel) => kernel.id)).toEqual([core.id])
    const resolve = createBodyPositionResolver(majorBodiesById, jd, whole)
    expect(resolve('mars')).toEqual(createBodyPositionResolver(majorBodiesById, jd, [])('mars'))
    expect(resolve('mars')).not.toEqual(createBodyPositionResolver(majorBodiesById, jd)('mars'))
  })

  it('shows lunar nodal evolution and keeps apparent readouts separate', () => {
    const first = currentOsculatingElements(body('moon'), body('earth'), 2459000.5)!
    const second = currentOsculatingElements(body('moon'), body('earth'), 2460826.5)!
    expect(Math.abs(first.ascendingNodeDeg - second.ascendingNodeDeg)).toBeGreaterThan(30)
    const geometric = currentObservation(body('naif:401'), body('mars'), jd, 'geometric')!
    const apparent = currentObservation(body('naif:401'), body('mars'), jd, 'light-time+stellar-aberration')!
    expect(geometric.lightTimeSeconds).toBe(0)
    expect(apparent.lightTimeSeconds).toBeGreaterThan(.01)
    expect(apparent.position).not.toEqual(geometric.position)
    expect(currentObservation(body('eris'), body('earth'), jd, 'light-time')).toBeNull()
    expect(currentObservation(body('moon'), body('earth'), jd, 'light-time')!.converged).toBe(true)
  })
})
