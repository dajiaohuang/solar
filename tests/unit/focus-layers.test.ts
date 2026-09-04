import { describe, expect, it } from 'vitest'
import { selectDetailBodies } from '../../src/lib/focusLayers'
import { buildCurrentPositions, buildTrajectories } from '../../src/lib/trajectory'
import { createBodyPositionResolver } from '../../src/lib/ephemeris'
import type { CelestialBody } from '../../src/types'

const sun: CelestialBody = { id: 'sun', name: 'Sun', kind: 'star', color: '#fff', size: 1, source: 'custom' }
// Synthetic throughput/semantics fixtures; not claims of precise source coverage.
const bodies: CelestialBody[] = [sun, ...Array.from({ length: 293 }, (_, i): CelestialBody => ({
  ...sun, id: `body-${i}`, kind: 'asteroid', orbit: { model: 'keplerian', epochJd: 2451545,
    semiMajorAxisAU: i + 1, eccentricity: 0, inclinationDeg: 10, ascendingNodeDeg: 20,
    argPeriapsisDeg: 30, meanAnomalyDeg: i, meanMotionDegPerDay: 1 },
}))]
const bodiesById = new Map(bodies.map(body => [body.id, body]))

describe('independent current positions and detail budgets', () => {
  it('keeps all 294 positions while bounding trails and prioritizing a late selected body', () => {
    const details = selectDetailBodies(bodies, 160, ['body-292', 'sun'])
    expect(details).toHaveLength(160)
    expect(details.map(body => body.id)).toContain('body-292')
    const current = buildCurrentPositions({ bodies, bodiesById, referenceId: 'sun', julianDay: 2451545 })
    expect(current.currentPositions).toHaveLength(294)
    expect(current.missingBodyIds).toEqual([])
    expect(buildTrajectories({ bodies: details, bodiesById, referenceId: 'sun', centerJulianDay: 2451545, historyDays: 1, sampleCount: 3 })).toHaveLength(160)
  })
  it('reuses absolute state across references and invalidates it for the next epoch', () => {
    const resolveBodyPosition = createBodyPositionResolver(bodiesById, 2451545, [])
    const original = resolveBodyPosition('body-292')
    const a = buildCurrentPositions({ bodies, bodiesById, referenceId: 'sun', julianDay: 2451545, resolveBodyPosition })
    const b = buildCurrentPositions({ bodies, bodiesById, referenceId: 'body-0', julianDay: 2451545, resolveBodyPosition })
    expect(resolveBodyPosition('body-292')).toBe(original)
    expect(a.currentPositions.map(item => item.body.id)).toEqual(b.currentPositions.map(item => item.body.id))
    const origin = resolveBodyPosition('body-0')
    for (let i = 0; i < bodies.length; i++) {
      expect(b.currentPositions[i].position3D!.x).toBeCloseTo(a.currentPositions[i].position3D!.x - origin.x, 12)
    }
    expect(createBodyPositionResolver(bodiesById, 2451546, [])('body-292')).not.toEqual(original)
  })
  it('reports a missing late position, not every unrequested historical trail', () => {
    const missing: CelestialBody = { ...sun, id: 'missing', kind: 'moon' }
    const selected = [...bodies, missing]
    const map = new Map([...bodiesById, [missing.id, missing] as const])
    const frame = buildCurrentPositions({ bodies: selected, bodiesById: map, referenceId: 'sun', julianDay: 2451545 })
    expect(frame.currentPositions).toHaveLength(294)
    expect(frame.missingBodyIds).toEqual(['missing'])
    expect(frame.trajectoryUnavailableBodyIds).toEqual([])
  })
})
