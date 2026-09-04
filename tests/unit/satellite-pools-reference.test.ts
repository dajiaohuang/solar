import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SpkKernel } from '../../src/engine/ephemeris/spk'
import { createKernelResolver, toEcliptic, type LoadedKernel } from '../../src/engine/ephemeris/kernelPool'
import { ephemerisProfile } from '../../src/data/ephemerisProfile'
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
    expect(fixture.contexts.map(context => context.rootId)).toEqual(full.files.filter(file => file.solutionKernelIds && !file.dependencyOnly).map(file => file.id))
    expect(fixture.contexts).toHaveLength(444)
    expect(fixture.samples).toHaveLength(1380)
    for (const context of fixture.contexts) {
      const root = byId.get(context.rootId)!
      expect(context.files.map(file => file.id)).toEqual([...root.solutionKernelIds!, root.id])
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
    expect(full.files.reduce((total, file) => total + file.bytes, 0)).toBe(1147897856)
    expect(pages.files.reduce((total, file) => total + file.bytes, 0)).toBe(270908416)
  })

  it('defaults native to full without imposing the Pages policy on explicit full Web builds', () => {
    expect(ephemerisProfile('native')).toBe('full')
    expect(ephemerisProfile()).toBe('pages')
    expect(ephemerisProfile('web', 'full')).toBe('full')
    expect(ephemerisProfile('native', 'pages')).toBe('pages')
    expect(() => ephemerisProfile('web', 'unknown')).toThrow('Unknown')
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
    for (const path of ['MOBILE.md', 'MOBILE-CN.md']) {
      const document = readFileSync(path, 'utf8')
      expect(document, path).toContain(`${(fullBytes / 1024 / 1024).toFixed(1)} MiB`)
      expect(document, path).toContain(String(full.files.length))
    }
  })
})
