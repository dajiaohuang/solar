import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { majorBodies, majorBodiesById } from '../../src/data/majorBodies'
import seeds from '../../src/data/ephemerisBodies.json'
import { bodyNaifId } from '../../src/data/ephemerisTargets'
import { EPHEMERIS_MANIFEST, installKernel, kernelCoverage, kernelStateForBody, kernelsForWindow, loadedKernels, kernelFilesForBodies } from '../../src/engine/ephemeris/kernelStore'
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
  it('loads complete TNO center chains only when those bodies are requested', () => {
    const tno = EPHEMERIS_MANIFEST.files.filter(file => file.id.startsWith('tnosat-'))
    expect(tno).toHaveLength(2)
    const initial = kernelFilesForBodies([body('earth')])
    for (const file of tno) {
      expect(file.core).toBe(false)
      expect(initial).not.toContain(file.id)
      expect(kernelFilesForBodies([body(file.id.includes('eris') ? 'eris' : 'haumea')])).toContain(file.id)
      expect(file.targets).toHaveLength(2)
    }
    const late = 2463000.5
    expect(kernelCoverage(body('haumea'), late).model).toBe('approximate-fallback')
  })
  it('covers 652 exact body centers and accounts for every remaining identity gap', () => {
    expect(majorBodies.filter((entry) => kernelCoverage(entry, jd).model === 'jpl-spk')).toHaveLength(652)
    expect(majorBodies.filter(entry => kernelCoverage(entry, jd).model !== 'jpl-spk').map(entry => entry.id).sort()).toEqual([
      'makemake', 'naif:120000617', 'naif:920000617', 'sat:planet:saturn:provisional:S/2009 S1',
    ].sort())
    expect(kernelCoverage(body('makemake'), jd).model).toBe('approximate-fallback')
    expect(bodyNaifId(body('eris'))).toBe(920136199)
    expect(bodyNaifId(body('haumea'))).toBe(920136108)
    const pool = createKernelResolver(loadedKernels(), utcJulianDayToEt(jd))
    const mars = kernelStateForBody(body('mars'), jd)!
    expect(mars).toEqual(pool.relative(499, 10))
    expect(mars).not.toEqual(pool.relative(4, 10))
  })
  it('resolves the batch-19 direct Horizons TNO centers without inventing companion states', () => {
    for (const [id, naifId] of [['asteroid:15810', 20015810], ['asteroid:90377', 20090377], ['asteroid:28978', 20028978], ['asteroid:225088', 20225088], ['asteroid:174567', 20174567]] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })
  it('resolves the batch-20 direct Horizons TNO centers without inventing companion states', () => {
    for (const [id, naifId] of [['asteroid:136472', 20136472], ['asteroid:55637', 20055637], ['asteroid:84522', 20084522], ['asteroid:145451', 20145451], ['asteroid:145452', 20145452]] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-21 direct Horizons TNO centers without inventing companion states', () => {
    for (const [id, naifId] of [['asteroid:55565', 20055565], ['asteroid:307261', 20307261], ['asteroid:208996', 20208996], ['asteroid:120132', 20120132], ['asteroid:55636', 20055636]] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-22 direct Horizons TNO centers without inventing companion states', () => {
    for (const [id, naifId, name] of [
      ['asteroid:15760', 20015760, '15760 Albion'],
      ['asteroid:19521', 20019521, '19521 Chaos'],
      ['asteroid:38083', 20038083, '38083 Rhadamanthus'],
      ['asteroid:38628', 20038628, '38628 Huya'],
      ['asteroid:53311', 20053311, '53311 Deucalion'],
    ] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(entry.shortName).toBe(name)
      expect(seeds.bodies.find((seed) => seed.id === id)).toMatchObject({ name, shortName: name })
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-23 direct Horizons TNO centers without inventing companion states', () => {
    for (const [id, naifId] of [['asteroid:523794', 20523794], ['asteroid:50666516', 50666516], ['asteroid:50760674', 50760674], ['asteroid:532037', 20532037], ['asteroid:541132', 20541132], ['asteroid:50773852', 50773852], ['asteroid:612911', 20612911], ['asteroid:471143', 20471143]] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-24 direct Horizons TNO centers without inventing companion states', () => {
    for (const [id, naifId] of [['asteroid:15874', 20015874], ['asteroid:19308', 20019308], ['asteroid:42301', 20042301], ['asteroid:47171', 20047171], ['asteroid:79360', 20079360], ['asteroid:84922', 20084922], ['asteroid:145453', 20145453], ['asteroid:229762', 20229762]] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-25 direct Horizons TNO centers without inventing companion states', () => {
    for (const [id, naifId] of [['asteroid:7066', 20007066], ['asteroid:8405', 20008405], ['asteroid:10370', 20010370]] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-26 direct Horizons Centaur centers without inventing companion states', () => {
    for (const [id, naifId] of [['asteroid:944', 20000944], ['asteroid:60558', 20060558], ['asteroid:54598', 20054598]] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-27 direct Horizons Centaur centers without inventing companion states', () => {
    for (const [id, naifId] of [['asteroid:5335', 20005335], ['asteroid:31824', 20031824], ['asteroid:32532', 20032532]] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-28 direct Horizons primaries without inventing companion states', () => {
    for (const [id, naifId] of [['asteroid:29981', 20029981], ['asteroid:52872', 20052872], ['asteroid:52975', 20052975]] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-29 direct Horizons primary without inventing companion states', () => {
    const entry = body('asteroid:55576')
    expect(entry.naifId).toBe(20055576)
    expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
    expect(kernelStateForBody(entry, jd)).not.toBeNull()
    expect(entry.source).toBe('jpl-spk-osculating-fallback')
  })

  it('resolves the batch-30 direct Horizons primaries without inventing companion states', () => {
    for (const [id, naifId] of [['asteroid:37117', 20037117], ['asteroid:83982', 20083982], ['asteroid:346889', 20346889]] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-31 direct Horizons primaries without inventing Typhon companion states', () => {
    for (const [id, naifId, name] of [
      ['asteroid:42355', 20042355, '42355 Typhon'],
      ['asteroid:330836', 20330836, '330836 Orius'],
      ['asteroid:463368', 20463368, '463368 Eurytus'],
    ] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(entry.shortName).toBe(name)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-32 direct Horizons primaries without inventing companion states', () => {
    for (const [id, naifId, name] of [
      ['asteroid:696315', 20696315, '696315 Petraios'],
      ['asteroid:78799', 20078799, '78799 Xewioso'],
      ['asteroid:90568', 20090568, '90568 Goibniu'],
    ] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(entry.shortName).toBe(name)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-33 direct Horizons TNO primaries without inventing companion states', () => {
    for (const [id, naifId, name] of [
      ['asteroid:58534', 20058534, '58534 Logos'],
      ['asteroid:65489', 20065489, '65489 Ceto'],
      ['asteroid:66652', 20066652, '66652 Borasisi'],
    ] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(entry.shortName).toBe(name)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('resolves the batch-34 direct Horizons TNO primaries without inventing companion states', () => {
    for (const [id, naifId, name] of [
      ['asteroid:88611', 20088611, '88611 Teharonhiawako'],
      ['asteroid:341520', 20341520, '341520 Mors-Somnus'],
    ] as const) {
      const entry = body(id)
      expect(entry.naifId).toBe(naifId)
      expect(entry.shortName).toBe(name)
      expect(kernelCoverage(entry, jd).model).toBe('jpl-spk')
      expect(kernelStateForBody(entry, jd)).not.toBeNull()
      expect(entry.source).toBe('jpl-spk-osculating-fallback')
    }
  })

  it('retains frozen fallback seeds against their original packaged source pool, not newly selected solutions', () => {
    const seededSourceKernelIds = new Set(seeds.bodies.map((entry) => entry.sourceKernelId))
    const seededDependencyKernelIds = new Set(loadedKernels().filter((kernel) => seededSourceKernelIds.has(kernel.id)).flatMap((kernel) => kernel.solutionKernelIds ?? []))
    const originalSources = loadedKernels().filter(kernel => (!kernel.dependencyOnly && kernel.solutionKernelIds === undefined) || seededSourceKernelIds.has(kernel.id) || seededDependencyKernelIds.has(kernel.id))
    const pool = createKernelResolver(originalSources, (seeds.epochJd - 2451545) * SECONDS_PER_DAY)
    for (const entry of seeds.bodies) {
      const parentId = bodyNaifId(body(entry.parentId))!
      const actual = pool.relative(entry.naifId, parentId)!
      expect(actual, `${entry.id} (${entry.sourceKernelId})`).not.toBeNull()
      const expected = entry.parentRelativeStateKm
      expect(Math.hypot(actual.position.x - expected.position.x, actual.position.y - expected.position.y, actual.position.z - expected.position.z), entry.id).toBeLessThan(1e-4)
    }
  })

  it('returns shared resolver positions and analytic SPK velocities in app units', () => {
    for (const id of ['earth', 'moon', 'mars', 'naif:401', 'jupiter', 'io', 'ceres', 'asteroid:2', 'eris', 'haumea']) {
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
    expect(currentObservation(body('makemake'), body('earth'), jd, 'light-time')).toBeNull()
    expect(currentObservation(body('eris'), body('earth'), jd, 'light-time')!.converged).toBe(true)
    expect(currentObservation(body('moon'), body('earth'), jd, 'light-time')!.converged).toBe(true)
  })
})
