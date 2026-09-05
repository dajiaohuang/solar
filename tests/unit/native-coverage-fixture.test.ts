import { describe, expect, it } from 'vitest'
import { createNativeCoverageResponder, nativeCoverageFixture, verifyNativeCoverageTraffic } from '../../scripts/native-coverage-fixture.mjs'

describe('explicitly synthetic native coverage transport', () => {
  it('never intercepts real manifest, plan or state routes', () => {
    const reply = createNativeCoverageResponder()
    for (const path of ['/v1/catalog/manifest', '/v1/coverage', '/v1/states/plan', '/v1/states/tiles/example']) expect(reply('GET', path)).toBeNull()
    expect(reply('POST', '/coverage-fixture/valid/v1/coverage')?.status).toBe(404)
    expect(reply('GET', '/coverage-fixture/unknown/v1/coverage')?.status).toBe(404)
  })
  it('creates isolated fixtures and serves valid then unavailable fresh reloads', () => {
    const reply = createNativeCoverageResponder(), fixture = nativeCoverageFixture()
    fixture.summary.counts.sourceRecords = 999
    expect(reply('GET', '/coverage-fixture/valid/v1/catalog/manifest')?.body).toEqual(nativeCoverageFixture().manifest)
    expect(reply('GET', '/coverage-fixture/valid/v1/coverage')?.body).toEqual(nativeCoverageFixture().summary)
    expect(reply('GET', '/coverage-fixture/valid/v1/coverage')?.status).toBe(404)
    expect(reply('GET', '/coverage-fixture/invalid/v1/coverage')?.body.counts.unresolvedSourceRecords).toBe(8)
    expect(createNativeCoverageResponder()('GET', '/coverage-fixture/valid/v1/coverage')?.status).toBe(200)
  })
  it('requires the complete load/reload/invalid sequence independently of real traffic', () => {
    const reply = createNativeCoverageResponder()
    const paths = ['valid/v1/catalog/manifest', 'valid/v1/coverage', 'valid/v1/catalog/manifest', 'valid/v1/coverage', 'invalid/v1/catalog/manifest', 'invalid/v1/coverage']
    const traffic = paths.map(suffix => {
      const path = '/coverage-fixture/' + suffix, value = reply('GET', path)!
      return { method: 'GET', path, status: value.status, bytes: JSON.stringify(value.body).length }
    })
    expect(verifyNativeCoverageTraffic([{ method: 'GET', path: '/v1/catalog/manifest', status: 200, bytes: 10 }, ...traffic]).requests).toBe(6)
    for (const invalid of [[], traffic.slice(1), [...traffic, traffic[0]], traffic.toReversed(), traffic.map(row => ({ ...row, bytes: 0 }))]) {
      expect(() => verifyNativeCoverageTraffic(invalid)).toThrow()
    }
  })
})
