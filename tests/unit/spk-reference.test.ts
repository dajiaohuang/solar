import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpkKernel, type SpkState } from '../../src/engine/ephemeris/spk'
import { createKernelResolver } from '../../src/engine/ephemeris/kernelPool'
import fixture from '../fixtures/jpl-spk-states.json'

const manifestPath = resolve(process.cwd(), 'src/data/ephemeris-manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const entries = (Array.isArray(manifest) ? manifest : manifest?.files ?? manifest?.kernels ?? []) as Array<Record<string, unknown>>
const AU_KM = 149597870.7
const EPS = 84381.448 * Math.PI / (180 * 3600)
const REQUIRED = [199, 301, 399, 599, 501, 699, 606, 999]

function rotateToEcliptic(s: SpkState): SpkState {
  if (s.frame === 17) return s
  const c = Math.cos(EPS), sn = Math.sin(EPS)
  const rot = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: c * v.y + sn * v.z, z: -sn * v.y + c * v.z })
  return { ...s, position: rot(s.position), velocity: rot(s.velocity), frame: 17 }
}

function toReference(s: SpkState) {
  const p = rotateToEcliptic(s).position, v = rotateToEcliptic(s).velocity
  return [p.x / AU_KM, p.y / AU_KM, p.z / AU_KM, v.x * 86400 / AU_KM, v.y * 86400 / AU_KM, v.z * 86400 / AU_KM]
}

describe('packaged SPK provenance and Horizons references', () => {
  const loaded = entries.map((entry) => {
    const path = resolve(process.cwd(), 'public/data/ephemerides', String(entry.path))
    const bytes = readFileSync(path)
    return { entry, path, kernel: new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), bytes }
  })
  const state = (target: number, et: number, seen = new Set<string>()): SpkState | null => {
    for (const item of [...loaded].reverse()) {
      const segment = item.kernel.segments.find((s) => s.target === target && et >= s.startEt && et <= s.endEt)
      if (!segment) continue
      const key = `${item.path}:${target}`
      if (seen.has(key)) throw new Error(`SPK center cycle at ${target}`)
      const own = rotateToEcliptic(item.kernel.evaluate(target, et)!)
      if (own.center === 0) return own
      const parent = state(own.center, et, new Set([...seen, key]))
      if (!parent) continue
      return { ...own, position: { x: own.position.x + parent.position.x, y: own.position.y + parent.position.y, z: own.position.z + parent.position.z }, velocity: { x: own.velocity.x + parent.velocity.x, y: own.velocity.y + parent.velocity.y, z: own.velocity.z + parent.velocity.z }, frame: own.frame }
    }
    return null
  }

  it('matches every manifest byte count and SHA-256', () => {
    expect(loaded.length).toBeGreaterThan(0)
    for (const item of loaded) {
      const expectedBytes = Number(item.entry.bytes)
      const expectedSha = String(item.entry.sha256)
      expect(statSync(item.path).size).toBe(expectedBytes)
      expect(createHash('sha256').update(item.bytes).digest('hex')).toBe(expectedSha)
    }
  })

  it('covers required targets at the modern fixture epoch', () => {
    const et = (2461288.5 - 2451545) * 86400
    for (const target of REQUIRED) expect(state(target, et), `target ${target}`).not.toBeNull()
  })

  it('pins every independent type 21 fixture to its provenance record', () => {
    const provenance = JSON.parse(readFileSync('tests/fixtures/spk21-provenance.json', 'utf8'))
    expect(provenance.oracle).toBe('NAIF CSPICE N0067')
    expect(provenance.fixtures).toHaveLength(10)
    for (const file of provenance.fixtures) {
      const bytes = readFileSync(`tests/fixtures/${file.path}`)
      expect(bytes.length).toBe(file.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
    }
  })

  it.each(['eris', 'haumea', 'makemake'])('evaluates original Horizons type 21 records against CSPICE: %s', (name) => {
    // These are small-body solution points, not proof of resolved primaries.
    const reference = JSON.parse(readFileSync(`tests/fixtures/spk21-${name}.json`, 'utf8'))
    const bytes = readFileSync(`tests/fixtures/spk21-horizons-${name}.bsp`)
    const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const core = loaded.find(item => String(item.entry.id).startsWith('de440s'))!
    for (const sample of reference.samples) {
      const own = kernel.evaluate(reference.target, sample.et)!
      const components = [own.position.x, own.position.y, own.position.z, own.velocity.x, own.velocity.y, own.velocity.z]
      components.forEach((value, axis) => expect(Math.abs(value - sample.heliocentricJ2000[axis])).toBeLessThan(axis < 3 ? 1e-5 : 1e-13))
      const bary = createKernelResolver([{ id: name, kernel }, { id: 'core', kernel: core.kernel }], sample.et).barycentric(reference.target)!
      const actual = [bary.position.x, bary.position.y, bary.position.z, bary.velocity.x, bary.velocity.y, bary.velocity.z]
      actual.forEach((value, axis) => expect(Math.abs(value - sample.barycentricEcliptic[axis])).toBeLessThan(axis < 3 ? 1e-5 : 1e-13))
    }
  })

  it.each(['eris', 'haumea'])('matches published TNO primary-center chains against CSPICE: %s', (name) => {
    const reference = JSON.parse(readFileSync(`tests/fixtures/spk21-${name}-primary.json`, 'utf8'))
    for (const sample of reference.samples) {
      const actual = state(reference.target, sample.et)!
      const components = [actual.position.x, actual.position.y, actual.position.z, actual.velocity.x, actual.velocity.y, actual.velocity.z]
      components.forEach((value, axis) => expect(Math.abs(value - sample.barycentricEcliptic[axis])).toBeLessThan(axis < 3 ? 1e-5 : 1e-13))
    }
    expect(state(reference.target, reference.firstEt - 1e-6)).toBeNull()
    expect(state(reference.target, reference.lastEt + 1e-6)).toBeNull()
  })

  it.each(['2451545.0', '2461288.5'])('agrees with independent Horizons states at JDTDB %s', (jd) => {
    const et = (Number(jd) - 2451545) * 86400
    const expected = (fixture.states as Record<string, Record<string, number[]>>)[jd]
    for (const [id, ref] of Object.entries(expected)) {
      const actual = state(Number(id), et)
      if (!actual) continue
      const sun = state(10, et)!
      const relative = { ...actual,
        position: { x: actual.position.x - sun.position.x, y: actual.position.y - sun.position.y, z: actual.position.z - sun.position.z },
        velocity: { x: actual.velocity.x - sun.velocity.x, y: actual.velocity.y - sun.velocity.y, z: actual.velocity.z - sun.velocity.z },
      }
      const got = toReference(relative)
      const toleranceKm = Number(id) === 301 ? 100 : [501, 599, 606, 699].includes(Number(id)) ? 100 : 10
      expect(Math.hypot(...got.slice(0, 3).map((v, i) => (v - ref[i]) * AU_KM)), `${jd}/${id}`).toBeLessThan(toleranceKm)
      expect(Math.hypot(...got.slice(3).map((v, i) => (v - ref[i + 3]) * AU_KM / 86400)), `${jd}/${id} velocity`).toBeLessThan(0.001)
    }
  })
})
