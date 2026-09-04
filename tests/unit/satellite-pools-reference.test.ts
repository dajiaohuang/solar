import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SpkKernel } from '../../src/engine/ephemeris/spk'
import { createKernelResolver, type LoadedKernel } from '../../src/engine/ephemeris/kernelPool'
import { ephemerisProfile } from '../../src/data/ephemerisProfile'
import type { KernelFile } from '../../src/engine/ephemeris/kernelStore'
import fixture from '../fixtures/satellite-pools-cspice.json'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const manifestBytes = readFileSync('src/data/ephemeris-manifest-full.json')
const full = JSON.parse(manifestBytes.toString()) as { files: KernelFile[] }
const pages = JSON.parse(readFileSync('src/data/ephemeris-manifest.json', 'utf8')) as { files: KernelFile[] }
const byId = new Map(full.files.map(file => [file.id, file]))

describe('integrated satellite source pools and delivery profiles', () => {
  it('pins the independent oracle, manifest, dependency order and all roots', () => {
    expect(fixture.oracle).toBe('CSPICE N0067 spkgeo_c')
    expect(digest(readFileSync('scripts/reference/spk-pool-oracle.c'))).toBe(fixture.oracleSourceSha256)
    expect(digest(manifestBytes)).toBe(fixture.manifestSha256)
    expect(fixture.contexts.map(context => context.rootId)).toEqual(full.files.filter(file => file.solutionKernelIds && !file.dependencyOnly).map(file => file.id))
    expect(fixture.contexts).toHaveLength(423)
    expect(fixture.samples).toHaveLength(1269)
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
      expect(samples).toHaveLength(3)
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
    expect(full.files.reduce((total, file) => total + file.bytes, 0)).toBe(524467200)
    expect(pages.files.reduce((total, file) => total + file.bytes, 0)).toBe(217626624)
  })

  it('defaults native to full without imposing the Pages policy on explicit full Web builds', () => {
    expect(ephemerisProfile('native')).toBe('full')
    expect(ephemerisProfile()).toBe('pages')
    expect(ephemerisProfile('web', 'full')).toBe('full')
    expect(ephemerisProfile('native', 'pages')).toBe('pages')
    expect(() => ephemerisProfile('web', 'unknown')).toThrow('Unknown')
  })
})
