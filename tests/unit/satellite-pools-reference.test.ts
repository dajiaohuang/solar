import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SpkKernel } from '../../src/engine/ephemeris/spk'
import { createKernelResolver, toEcliptic, type LoadedKernel } from '../../src/engine/ephemeris/kernelPool'
import type { KernelFile } from '../../src/engine/ephemeris/kernelStore'
import fixture from '../fixtures/satellite-pools-cspice.json'
import { SMALL_BODY_PRIMARIES, SATELLITE_IDENTITIES } from '../../src/data/satelliteIdentities'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const manifestBytes = readFileSync('src/data/ephemeris-manifest-full.json')
const full = JSON.parse(manifestBytes.toString()) as { files: KernelFile[] }
const pages = JSON.parse(readFileSync('src/data/ephemeris-manifest.json', 'utf8')) as { files: KernelFile[] }
const byId = new Map(full.files.map(file => [file.id, file]))

describe('integrated satellite source pools and delivery profiles', () => {
  it('keeps each new binary in one original source with distinct primary and component identities', () => {
    const load = (entry: KernelFile): LoadedKernel => {
      const bytes = readFileSync(`public/data/ephemerides/${entry.path}`)
      expect(digest(bytes)).toBe(entry.sha256)
      return { ...entry, kernel: new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) }
    }
    const core = load(full.files.find(file => file.id.startsWith('de440s-'))!)
    for (const primary of SMALL_BODY_PRIMARIES) {
      const companion = SATELLITE_IDENTITIES.find(moon => moon.parentId === primary.id)!
      const long = full.files.find(file => file.id === `system-${primary.id}-2020-2030`)!
      const short = pages.files.find(file => file.id === `system-${primary.id}-2026-07-01-2027-01-01`)!
      expect(long.source).toBe(primary.sourceUrl)
      expect(companion.sourceEphemerides).toEqual([primary.sourceEphemeris])
      expect([...long.targets].sort((a, b) => a - b)).toEqual([primary.naifId, primary.systemNaifId, companion.naifId!].sort((a, b) => a - b))
      expect([long.startEt, long.endEt]).toEqual([631108800, 946728000])
      expect([short.startEt, short.endEt]).toEqual([836136000, 852033600])
      const original = load(long), narrowed = load(short)
      for (const et of [short.startEt, (short.startEt + short.endEt) / 2, short.endEt]) {
        for (const target of long.targets) expect(narrowed.kernel.evaluate(target, et)).toEqual(original.kernel.evaluate(target, et))
        const resolver = createKernelResolver([core, narrowed], et)
        expect(resolver.relative(companion.naifId!, primary.naifId)).not.toBeNull()
        expect(createKernelResolver([narrowed], et).barycentric(primary.naifId)).toBeNull()
      }
      expect(narrowed.kernel.evaluate(primary.naifId, short.startEt - 1)).toBeNull()
      expect(narrowed.kernel.evaluate(companion.naifId!, short.endEt + 1)).toBeNull()
      expect(original.kernel.evaluate(primary.naifId, short.startEt - 1)).not.toBeNull()
    }
  })
  it('subtracts the same publication primary offset for TNO moons instead of treating the system as the primary', () => {
    for (const [target, primary, system] of [[120136199, 920136199, 20136199], [120136108, 920136108, 20136108], [220136108, 920136108, 20136108]]) {
      const file = full.files.find(file => file.targets.includes(target))!
      const load = (entry: KernelFile): LoadedKernel => {
        const bytes = readFileSync(`public/data/ephemerides/${entry.path}`)
        return { ...entry, kernel: new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) }
      }
      const pool = [...file.solutionKernelIds!.map(id => load(byId.get(id)!)), load(file)]
      const parentFile = byId.get(file.solutionKernelIds![1])!
      expect(parentFile.source).toBe(file.source)
      expect(parentFile.targets).toEqual([primary, system])
      const et = (file.startEt + file.endEt) / 2
      expect(createKernelResolver([pool[0], pool[2]], et).relative(target, primary)).toBeNull()
      const resolver = createKernelResolver(pool, et)
      const actual = resolver.relative(target, primary)!
      const own = pool[2].kernel.evaluate(target, et)!
      const parent = pool[1].kernel.evaluate(primary, et)!
      expect(own.center).toBe(system)
      for (const label of ['position', 'velocity'] as const) {
        const expected = toEcliptic({ x: own[label].x - parent[label].x, y: own[label].y - parent[label].y, z: own[label].z - parent[label].z }, 1)
        for (const axis of ['x', 'y', 'z'] as const) expect(Math.abs(actual[label][axis] - expected[axis])).toBeLessThan(label === 'position' ? 2e-6 : 1e-9)
      }
      if (primary === 920136108) expect(actual).not.toEqual(resolver.relative(target, system))
    }
  })
  it('retains Daphnis Type 17 and the published SAT393 embedded center chain', () => {
    const file = byId.get('satellite-daphnis-sat393-635-2020-2031')!
    expect(file.solutionKernelIds).toEqual(['sat393-embedded-satellite-2020-2031'])
    const dependency = byId.get(file.solutionKernelIds![0])!
    expect(dependency.source).toBe('https://naif.jpl.nasa.gov/pub/naif/pds/wgc/kernels/spk/sat393.bsp')
    expect(dependency.dependencyOnly).toBe(true)
    const load = (entry: KernelFile): LoadedKernel => {
      const bytes = readFileSync(`public/data/ephemerides/${entry.path}`)
      return { ...entry, kernel: new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) }
    }
    const root = load(file), core = load(dependency)
    const et = (file.startEt + file.endEt) / 2
    expect(root.kernel.segments.map(({ target, center, type }) => [target, center, type])).toEqual([[635, 699, 17]])
    expect(core.kernel.segments.map(({ target, center }) => [target, center]).sort((a, b) => a[0] - b[0])).toEqual([[6, 0], [10, 0], [699, 6]])
    const legacy = load(full.files.find(entry => entry.id.startsWith('de440s-'))!)
    expect(createKernelResolver([legacy, root], et).relative(635, 10)).toBeNull()
    expect(createKernelResolver([core, root], et).relative(635, 10)).not.toBeNull()
    expect(createKernelResolver([legacy, core, root], et).relative(635, 10)).toEqual(createKernelResolver([core, root], et).relative(635, 10))
  })
  it('requires the modern SAT415 embedded DE437 pool instead of borrowing DE440', () => {
    const file = byId.get('satellite-naif-sat415-610-2020-2031')!
    expect(file.solutionKernelIds).toEqual(['de437-sat415-satellite-2020-2031'])
    const dependency = byId.get(file.solutionKernelIds![0])!
    expect(dependency.source).toBe(file.source)
    expect([...dependency.targets].sort((a, b) => a - b)).toEqual([6, 10, 699])
    expect(dependency.dependencyOnly).toBe(true)
    const load = (entry: KernelFile): LoadedKernel => {
      const bytes = readFileSync(`public/data/ephemerides/${entry.path}`)
      return { ...entry, kernel: new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) }
    }
    const root = load(file)
    const legacy = load(full.files.find(entry => entry.id.startsWith('de440s-'))!)
    const et = (file.startEt + file.endEt) / 2
    expect(root.kernel.evaluate(610, et)?.center).toBe(6)
    expect(createKernelResolver([legacy, root], et).relative(610, 10)).toBeNull()
    const core = load(dependency)
    const resolved = createKernelResolver([legacy, core, root], et)
    expect(resolved.relative(610, 10)).toEqual(createKernelResolver([core, root], et).relative(610, 10))
    expect(resolved.relative(610, 699)).not.toEqual(resolved.relative(610, 6))
  })
  it('pins the independent oracle, manifest, dependency order and all roots', () => {
    expect(fixture.oracle).toBe('CSPICE N0067 spkgeo_c')
    expect(digest(readFileSync('scripts/reference/spk-pool-oracle.c'))).toBe(fixture.oracleSourceSha256)
    expect(digest(manifestBytes)).toBe(fixture.manifestSha256)
    // The independent CSPICE fixture predates the latest Horizons batch; the
    // new roots have their own source/hash/state checks below and are not
    // silently treated as CSPICE oracle coverage.
    const oracleRoots = full.files.filter(file => !['horizons-asteroids-batch7-20260909', 'horizons-asteroids-batch8-20260909', 'horizons-asteroids-batch9-20260909', 'horizons-asteroids-batch10-20260909', 'horizons-asteroids-batch11-20260909', 'horizons-asteroids-batch12-20260909', 'horizons-asteroids-batch13-20260909', 'horizons-asteroids-batch14-20260909', 'horizons-asteroids-batch15-20260909', 'horizons-asteroids-batch16-20260910', 'horizons-asteroids-batch17-20260910'].includes(file.integrationBatch ?? '') && ((file.solutionKernelIds && !file.dependencyOnly) || file.id === 'de440s-2000-01-01-2051-01-01'))
    expect(fixture.contexts.map(context => context.rootId)).toEqual(oracleRoots.map(file => file.id))
    expect(fixture.contexts).toHaveLength(445)
    expect(fixture.samples).toHaveLength(1422)
    for (const context of fixture.contexts) {
      const root = byId.get(context.rootId)!
      expect(context.files.map(file => file.id)).toEqual([...(root.solutionKernelIds ?? []), root.id])
    }
  })

  it('matches independent heliocentric and barycentric six-vectors for every added root', () => {
    // Retain only shared dependencies, not the entire half-gigabyte full pack.
    const dependencies = new Map<string, LoadedKernel>()
    for (const [index, context] of fixture.contexts.entries()) {
      const pool = context.files.map(file => {
        const cached = dependencies.get(file.id)
        if (cached) return cached
        const entry = byId.get(file.id)!
        const bytes = readFileSync(`public/data/ephemerides/${entry.path}`)
        expect(entry.sha256).toBe(file.sha256)
        expect(digest(bytes)).toBe(file.sha256)
        expect(bytes.length).toBe(entry.bytes)
        const loaded = { ...entry, kernel: new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) }
        if (file.id !== context.rootId) dependencies.set(file.id, loaded)
        return loaded
      })
      const samples = fixture.samples.filter(sample => sample.context === index)
      const root = byId.get(context.rootId)!
      expect(samples).toHaveLength(3 * root.targets.length)
      for (const target of root.targets) expect(samples.filter(sample => sample.target === target).map(sample => sample.et)).toEqual([root.startEt, (root.startEt + root.endEt) / 2, root.endEt])
      for (const sample of samples) {
        const resolver = createKernelResolver(pool, sample.et)
        for (const [label, actual] of [ ['heliocentric', resolver.relative(sample.target, 10)], ['barycentric', resolver.barycentric(sample.target)] ] as const) {
          expect(actual, `${context.rootId}/${sample.et}/${label}`).not.toBeNull()
          const values = [actual!.position.x, actual!.position.y, actual!.position.z, actual!.velocity.x, actual!.velocity.y, actual!.velocity.z]
          values.forEach((value, axis) => expect(Math.abs(value - sample[label][axis]), `${context.rootId}/${sample.et}/${label}/${axis}`).toBeLessThan(axis < 3 ? 2e-6 : 1e-9))
        }
      }
    }
  }, 60000)

  it('keeps the same target identities with explicit narrower Pages windows', () => {
    const targets = (files: KernelFile[]) => [...new Set(files.filter(file => !file.dependencyOnly).flatMap(file => file.targets))].sort((a, b) => a - b)
    expect(targets(pages.files)).toEqual(targets(full.files))
    for (const manifest of [pages, full]) {
      const ids = new Set(manifest.files.map(file => file.id))
      expect(ids.size).toBe(manifest.files.length)
      for (const file of manifest.files) {
        expect(file.bytes).toBeLessThanOrEqual(128 * 1024 * 1024)
        for (const dependency of file.solutionKernelIds ?? []) expect(ids.has(dependency)).toBe(true)
      }
    }
    const shortened = pages.files.filter(file => file.path.includes('2026-2027'))
    expect(shortened.length).toBeGreaterThan(0)
    for (const file of shortened) {
      expect(file.startEt).toBe(820497600)
      expect(file.endEt).toBe(852033600)
      const bytes = readFileSync(`public/data/ephemerides/${file.path}`)
      expect(digest(bytes)).toBe(file.sha256)
      const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      for (const target of file.targets) {
        expect(kernel.evaluate(target, file.startEt)).not.toBeNull()
        expect(kernel.evaluate(target, file.endEt)).not.toBeNull()
        expect(kernel.evaluate(target, file.startEt - 1)).toBeNull()
        expect(kernel.evaluate(target, file.endEt + 1)).toBeNull()
      }
    }
    expect(full.files.reduce((total, file) => total + file.bytes, 0)).toBe(1167155200)
    expect(pages.files.reduce((total, file) => total + file.bytes, 0)).toBe(272951296)
  })

  it('pins the bounded Horizons asteroid snapshots without treating the API as immutable', () => {
    const expected = new Map([
      [20000243, '243'], [20000433, '433'], [20000951, '951'],
      [20025143, '25143'], [20099942, '99942'], [20162173, '162173'],
      [20003200, '3200'], [20003122, '3122'], [20065803, '65803'],
      [20004179, '4179'], [20001036, '1036'], [20001580, '1580'],
      [20002867, '2867'], [20052768, '52768'], [20029075, '29075'], [20231937, '231937'],
      [20486958, '486958'], [20132524, '132524'], [20152830, '152830'], [20341843, '341843'], [20469219, '469219'], [20162421, '162421'],
      [20153591, '153591'], [20308635, '308635'], [20163899, '163899'], [20357439, '357439'], [20367943, '367943'],
      [20000006, '6'], [20000009, '9'], [20000014, '14'], [20000018, '18'],
      [20000019, '19'], [20000090, '90'], [20000216, '216'],
      [20000011, '11'], [20000013, '13'], [20000021, '21'], [20000024, '24'],
      [20000029, '29'], [20000039, '39'], [20000044, '44'],
      [20000005, '5'], [20000008, '8'], [20000012, '12'], [20000020, '20'], [20000040, '40'],
      [20003753, '3753'], [20006489, '6489'], [20006178, '6178'], [20046610, '46610'], [20098943, '98943'],
      [20000025, '25'], [20000027, '27'], [20000030, '30'], [20000034, '34'], [20000037, '37'],
      [20000087, '87'], [20000107, '107'], [20000511, '511'], [20000704, '704'],
      [20000017, '17'], [20000023, '23'], [20000026, '26'], [20000028, '28'], [20000032, '32'],
      [20000051, '51'], [20002060, '2060'], [20005145, '5145'], [20010199, '10199'], [20020000, '20000'],
      [20000015, '15'], [20000088, '88'], [20000624, '624'], [20000911, '911'],
      [20000033, '33'], [20000035, '35'], [20000036, '36'], [20000038, '38'],
      [20000041, '41'], [20000046, '46'], [20000048, '48'], [20000049, '49'],
    ])
    const roots = pages.files.filter(file => ['horizons-asteroids-20260909', 'horizons-asteroids-next-20260909', 'horizons-asteroids-followup-20260909', 'horizons-asteroids-batch3-20260909', 'horizons-asteroids-batch4-20260909', 'horizons-asteroids-batch5-20260909', 'horizons-asteroids-batch6-20260909', 'horizons-asteroids-batch7-20260909', 'horizons-asteroids-batch8-20260909', 'horizons-asteroids-batch11-20260909', 'horizons-asteroids-batch12-20260909', 'horizons-asteroids-batch13-20260909', 'horizons-asteroids-batch14-20260909', 'horizons-asteroids-batch15-20260909', 'horizons-asteroids-batch16-20260910', 'horizons-asteroids-batch17-20260910'].includes(file.integrationBatch ?? ''))
    expect(roots).toHaveLength(expected.size)
    for (const file of roots) {
      const target = file.targets[0]
      expect(expected.get(target)).toBeTruthy()
      expect(file.source).toMatch(/^https:\/\/ssd\.jpl\.nasa\.gov\/api\/horizons\.api/)
      expect(file.sourceIdentity).toMatchObject({ target, responseSha256: expect.any(String), sha256: expect.any(String), retrievedAt: expect.any(String) })
      expect(file.selectionEvidence.sourceSnapshot).toEqual({
        responseSha256: file.sourceIdentity.responseSha256,
        binarySha256: file.sourceIdentity.sha256,
        retrievedAt: file.sourceIdentity.retrievedAt,
      })
      expect(file.solutionKernelIds).toBeUndefined()
      expect(file.targets).toEqual([target])
    }
  })

  it('evaluates every batch-7 Horizons root at both delivery profiles', () => {
    const roots = full.files.filter(file => file.integrationBatch === 'horizons-asteroids-batch7-20260909')
    expect(roots).toHaveLength(5)
    for (const root of roots) {
      expect(root.targets).toHaveLength(1)
      const bytes = readFileSync(`public/data/ephemerides/${root.path}`)
      expect(bytes.length).toBe(root.bytes)
      expect(digest(bytes)).toBe(root.sha256)
      const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const target = root.targets[0]
      for (const et of [root.startEt, (root.startEt + root.endEt) / 2, root.endEt]) {
        expect(kernel.evaluate(target, et), `${root.id}/${et}`).not.toBeNull()
      }
    }
  })

  it('evaluates every batch-8 Horizons root at both delivery profiles', () => {
    const roots = full.files.filter(file => file.integrationBatch === 'horizons-asteroids-batch8-20260909')
    expect(roots).toHaveLength(5)
    for (const root of roots) {
      expect(root.targets).toHaveLength(1)
      const bytes = readFileSync(`public/data/ephemerides/${root.path}`)
      expect(bytes.length).toBe(root.bytes)
      expect(digest(bytes)).toBe(root.sha256)
      const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const target = root.targets[0]
      for (const et of [root.startEt, (root.startEt + root.endEt) / 2, root.endEt]) {
        expect(kernel.evaluate(target, et), `${root.id}/${et}`).not.toBeNull()
      }
    }
  })

  it('evaluates every batch-9 Horizons root at both delivery profiles', () => {
    const roots = full.files.filter(file => file.integrationBatch === 'horizons-asteroids-batch9-20260909')
    expect(roots).toHaveLength(5)
    for (const root of roots) {
      expect(root.targets).toHaveLength(1)
      const bytes = readFileSync(`public/data/ephemerides/${root.path}`)
      expect(bytes.length).toBe(root.bytes)
      expect(digest(bytes)).toBe(root.sha256)
      const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const target = root.targets[0]
      for (const et of [root.startEt, (root.startEt + root.endEt) / 2, root.endEt]) {
        expect(kernel.evaluate(target, et), `${root.id}/${et}`).not.toBeNull()
      }
    }
  })

  it('evaluates every batch-10 Horizons root at both delivery profiles', () => {
    const roots = full.files.filter(file => file.integrationBatch === 'horizons-asteroids-batch10-20260909')
    expect(roots).toHaveLength(5)
    for (const root of roots) {
      expect(root.targets).toHaveLength(1)
      const bytes = readFileSync(`public/data/ephemerides/${root.path}`)
      expect(bytes.length).toBe(root.bytes)
      expect(digest(bytes)).toBe(root.sha256)
      const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const target = root.targets[0]
      for (const et of [root.startEt, (root.startEt + root.endEt) / 2, root.endEt]) {
        expect(kernel.evaluate(target, et), `${root.id}/${et}`).not.toBeNull()
      }
    }
  })

  it('evaluates every batch-11 Horizons root at both delivery profiles', () => {
    const roots = full.files.filter(file => file.integrationBatch === 'horizons-asteroids-batch11-20260909')
    expect(roots).toHaveLength(5)
    for (const root of roots) {
      expect(root.targets).toHaveLength(1)
      const bytes = readFileSync(`public/data/ephemerides/${root.path}`)
      expect(bytes.length).toBe(root.bytes)
      expect(digest(bytes)).toBe(root.sha256)
      const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const target = root.targets[0]
      for (const et of [root.startEt, (root.startEt + root.endEt) / 2, root.endEt]) {
        expect(kernel.evaluate(target, et), `${root.id}/${et}`).not.toBeNull()
      }
    }
  })

  it('evaluates every batch-12 Horizons root at both delivery profiles', () => {
    const roots = full.files.filter(file => file.integrationBatch === 'horizons-asteroids-batch12-20260909')
    expect(roots).toHaveLength(4)
    for (const root of roots) {
      expect(root.targets).toHaveLength(1)
      const bytes = readFileSync(`public/data/ephemerides/${root.path}`)
      expect(bytes.length).toBe(root.bytes)
      expect(digest(bytes)).toBe(root.sha256)
      const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const target = root.targets[0]
      for (const et of [root.startEt, (root.startEt + root.endEt) / 2, root.endEt]) {
        expect(kernel.evaluate(target, et), `${root.id}/${et}`).not.toBeNull()
      }
    }
  })

  it('evaluates every batch-13 Horizons root at both delivery profiles', () => {
    const roots = full.files.filter(file => file.integrationBatch === 'horizons-asteroids-batch13-20260909')
    expect(roots).toHaveLength(5)
    for (const root of roots) {
      expect(root.targets).toHaveLength(1)
      const bytes = readFileSync(`public/data/ephemerides/${root.path}`)
      expect(bytes.length).toBe(root.bytes)
      expect(digest(bytes)).toBe(root.sha256)
      const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const target = root.targets[0]
      for (const et of [root.startEt, (root.startEt + root.endEt) / 2, root.endEt]) {
        expect(kernel.evaluate(target, et), `${root.id}/${et}`).not.toBeNull()
      }
    }
  })

  it('evaluates every batch-14 Horizons root at both delivery profiles', () => {
    const roots = full.files.filter(file => file.integrationBatch === 'horizons-asteroids-batch14-20260909')
    expect(roots).toHaveLength(5)
    for (const root of roots) {
      expect(root.targets).toHaveLength(1)
      const bytes = readFileSync(`public/data/ephemerides/${root.path}`)
      expect(bytes.length).toBe(root.bytes)
      expect(digest(bytes)).toBe(root.sha256)
      const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const target = root.targets[0]
      for (const et of [root.startEt, (root.startEt + root.endEt) / 2, root.endEt]) {
        expect(kernel.evaluate(target, et), `${root.id}/${et}`).not.toBeNull()
      }
    }
  })

  it('evaluates every batch-15 Horizons root at both delivery profiles and preserves primary-only boundaries', () => {
    const roots = full.files.filter(file => file.integrationBatch === 'horizons-asteroids-batch15-20260909')
    expect(roots).toHaveLength(4)
    expect(roots.map(root => root.targets[0])).toEqual([20000015, 20000088, 20000624, 20000911])
    for (const root of roots) {
      expect(root.targets).toHaveLength(1)
      const bytes = readFileSync(`public/data/ephemerides/${root.path}`)
      expect(bytes.length).toBe(root.bytes)
      expect(digest(bytes)).toBe(root.sha256)
      const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const target = root.targets[0]
      for (const et of [root.startEt, (root.startEt + root.endEt) / 2, root.endEt]) {
        expect(kernel.evaluate(target, et), `${root.id}/${et}`).not.toBeNull()
      }
      if ([20000624, 20000911].includes(target)) {
        expect(root.selectionEvidence.stateBoundary).toBe('Primary heliocentric state only; companion/system-center coverage is not included.')
      } else {
        expect(root.selectionEvidence.stateBoundary).toBeUndefined()
      }
    }
  })

  it('evaluates every batch-16 Horizons root at both delivery profiles and preserves the primary-only boundary', () => {
    const roots = full.files.filter(file => file.integrationBatch === 'horizons-asteroids-batch16-20260910')
    expect(roots).toHaveLength(4)
    expect(roots.map(root => root.targets[0])).toEqual([20000033, 20000035, 20000036, 20000038])
    for (const root of roots) {
      expect(root.targets).toHaveLength(1)
      const bytes = readFileSync(`public/data/ephemerides/${root.path}`)
      expect(bytes.length).toBe(root.bytes)
      expect(digest(bytes)).toBe(root.sha256)
      const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const target = root.targets[0]
      for (const et of [root.startEt, (root.startEt + root.endEt) / 2, root.endEt]) {
        expect(kernel.evaluate(target, et), `${root.id}/${et}`).not.toBeNull()
      }
      expect(root.selectionEvidence.stateBoundary).toBe('Primary heliocentric state only; companion/system-center coverage is not included.')
    }
  })

  it('evaluates every batch-17 Horizons root at both delivery profiles and preserves the primary-only boundary', () => {
    const roots = full.files.filter(file => file.integrationBatch === 'horizons-asteroids-batch17-20260910')
    expect(roots).toHaveLength(4)
    expect(roots.map(root => root.targets[0])).toEqual([20000041, 20000046, 20000048, 20000049])
    for (const root of roots) {
      expect(root.targets).toHaveLength(1)
      const bytes = readFileSync(`public/data/ephemerides/${root.path}`)
      expect(bytes.length).toBe(root.bytes)
      expect(digest(bytes)).toBe(root.sha256)
      const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const target = root.targets[0]
      for (const et of [root.startEt, (root.startEt + root.endEt) / 2, root.endEt]) {
        expect(kernel.evaluate(target, et), `${root.id}/${et}`).not.toBeNull()
      }
      expect(root.selectionEvidence.stateBoundary).toBe('Primary heliocentric state only; companion/system-center coverage is not included.')
    }
  })

  it('keeps English and Chinese delivery documentation aligned with both manifests', () => {
    const fullBytes = full.files.reduce((total, file) => total + file.bytes, 0)
    const pagesBytes = pages.files.reduce((total, file) => total + file.bytes, 0)
    for (const path of ['README.md', 'README-CN.md', 'docs/physical-ephemerides.md']) {
      const document = readFileSync(path, 'utf8')
      for (const bytes of [fullBytes, pagesBytes]) {
        expect(document, path).toContain(bytes.toLocaleString('en-US'))
        expect(document, path).toContain(`${(bytes / 1024 / 1024).toFixed(1)} MiB`)
      }
    }
    // Native applications consume verified backend tiles. Their packaging is
    // checked by native:check and must not require an offline SPK profile.
  })
})
