import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { SpkKernel } from '../../src/engine/ephemeris/spk'
import { kernelsCoveringInterval, type LoadedKernel } from '../../src/engine/ephemeris/kernelPool'
import { utcJulianDayToEt } from '../../src/engine/ephemeris/timeScales'
import { buildSpacecraftFrame } from '../../src/engine/ephemeris/spacecraft'
import type { CelestialBody } from '../../src/types'

const data = vi.hoisted(() => ({ kernels: [] as LoadedKernel[] }))
vi.mock('../../src/engine/ephemeris/kernelStore', () => ({
  loadedKernels: () => data.kernels,
  kernelsForWindow: (from: number, to: number) => kernelsCoveringInterval(data.kernels, utcJulianDayToEt(from), utcJulianDayToEt(to)),
}))
const jd = (date: string) => Date.parse(date) / 86400000 + 2440587.5
const target: CelestialBody = { id: 'himalia', naifId: 506, name: 'Himalia', kind: 'moon', source: 'jpl-satellite-inventory', color: '#fff', size: 1 }
const sun: CelestialBody = { ...target, id: 'sun', naifId: 10, kind: 'star' }
const bodies = new Map([target, sun].map(body => [body.id, body]))

describe('spacecraft historical reference coverage', () => {
  it('keeps a valid current marker but omits a trail whose reference lacks full historical coverage', () => {
    data.kernels = ['public/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp', 'tests/fixtures/jup347-himalia-join.bsp'].map(id => {
      const bytes = readFileSync(id)
      return { id, kernel: new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) }
    })
    const current = jd('2023-12-11T12:00:00Z')
    const probe = { ...target, id: 'probe', kind: 'spacecraft' as const,
      trajectoryPoints: [{ jd: jd('2023-12-09T12:00:00Z'), x: 1, y: 0, z: 0 }, { jd: current, x: 2, y: 0, z: 0 }],
    }
    const frame = buildSpacecraftFrame([probe], target.id, bodies, current)
    expect(Array.from({ length: frame.currentPositions.length }, (_, i) => frame.currentPositions.bodyAt(i).id)).toEqual(['probe'])
    expect(frame.trajectories).toEqual([])
    expect(frame.trajectoryUnavailableBodyIds).toEqual(['probe'])
    const covered = { ...probe, trajectoryPoints: [{ ...probe.trajectoryPoints[0], jd: jd('2023-12-10T12:00:00Z') }, probe.trajectoryPoints[1]] }
    expect(buildSpacecraftFrame([covered], target.id, bodies, current).trajectories).toHaveLength(1)
  })
})
