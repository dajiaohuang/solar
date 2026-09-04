import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { majorBodies, majorBodiesById } from '../../src/data/majorBodies'
import { EPHEMERIS_MANIFEST, installKernel, kernelCoverage } from '../../src/engine/ephemeris/kernelStore'
import { createBodyPositionResolver, vector3Magnitude } from '../../src/lib/ephemeris'
import { getRelativePositions, toPlanarPoint } from '../../src/lib/referenceFrame'
import { buildCurrentPositions } from '../../src/lib/trajectory'
import type { CelestialBody } from '../../src/types'

// Reproduce the pre-change per-frame resolver and quadratic missing-ID scan.
function baseline(bodies: CelestialBody[], referenceId: string, jd: number) {
  const resolve = createBodyPositionResolver(majorBodiesById, jd)
  const currentPositions = getRelativePositions(bodies, referenceId, resolve).map(item => ({
    body: item.body, planarPosition: toPlanarPoint(item.position), position3D: item.position,
    distance: vector3Magnitude(item.position),
  }))
  return {
    currentPositions,
    trajectoryUnavailableBodyIds: [],
    missingBodyIds: bodies.filter(body => !currentPositions.some(item => item.body.id === body.id)).map(body => body.id),
    maxDistance: currentPositions.reduce((largest, item) => Math.max(largest, item.distance), 0),
  }
}
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]

it('measures real-source dual-frame state work without substituting point count for SPK coverage', () => {
  for (const file of EPHEMERIS_MANIFEST.files) {
    const bytes = readFileSync(`public/data/ephemerides/${file.path}`)
    installKernel(file.id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  }
  const saturn = majorBodies.filter(body => body.id === 'saturn' || body.parentId === 'saturn')
  const rows = []
  for (const bodies of [saturn.slice(0, 160), saturn, majorBodies]) {
    const oldTimes: number[] = [], newTimes: number[] = []
    for (let tick = -10; tick < 80; tick++) {
      const jd = 2461287.5 + tick / 1000
      let previous: ReturnType<typeof baseline>[] = [], current: ReturnType<typeof buildCurrentPositions>[] = []
      const runOld = () => {
        const start = performance.now()
        previous = ['saturn', 'titan'].map(referenceId => baseline(bodies, referenceId, jd))
        if (tick >= 0) oldTimes.push(performance.now() - start)
      }
      const runNew = () => {
        const start = performance.now()
        const resolveBodyPosition = createBodyPositionResolver(majorBodiesById, jd)
        current = ['saturn', 'titan'].map(referenceId => buildCurrentPositions({ bodies, bodiesById: majorBodiesById, referenceId, julianDay: jd, resolveBodyPosition }))
        if (tick >= 0) newTimes.push(performance.now() - start)
      }
      // Alternate ordering so one variant is not always the warm-cache second.
      if (tick % 2) { runOld(); runNew() } else { runNew(); runOld() }
      expect(current).toEqual(previous)
    }
    const coverage = bodies.map(body => kernelCoverage(body, 2461287.5).model)
    rows.push({ selected: bodies.length, spk: coverage.filter(model => model === 'jpl-spk').length,
      fallback: coverage.filter(model => model === 'approximate-fallback').length,
      missing: coverage.filter(model => model === 'unavailable').length,
      frames: 2, measuredTicks: 80, baselineP50Ms: percentile(oldTimes, .5), baselineP90Ms: percentile(oldTimes, .9),
      sharedP50Ms: percentile(newTimes, .5), sharedP90Ms: percentile(newTimes, .9) })
  }
  console.log(JSON.stringify({ manifest: EPHEMERIS_MANIFEST.id, rows,
    boundary: 'Node CPU state evaluation only, original loaded SPK sources at stated epochs; excludes browser, GPU, network/kernel load and real-device frame guarantees. Baseline processes the same body set without the old 160 prefix so this compares throughput at equal work.' }, null, 2))
}, 60_000)
