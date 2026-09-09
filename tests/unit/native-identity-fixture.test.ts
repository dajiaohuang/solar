import { expect, it } from 'vitest'
// @ts-expect-error The native harness is an executable JavaScript module.
import { createNativeIdentityResponder, verifyNativeIdentityTraffic } from '../../scripts/native-identity-fixture.mjs'

it('keeps native directory fixtures synthetic and rejects stale selection before any state request', () => {
  const reply = createNativeIdentityResponder(), traffic: { path: string; method: string; status: number; bytes: number }[] = []
  function get(path: string) { const response = reply('GET', path); traffic.push({ path, method: 'GET', status: response.status, bytes: JSON.stringify(response.body).length }); return response.body }
  expect(reply('GET', '/v1/catalog/manifest')).toBeNull()
  const first = get('/identity-fixture/v1/catalog/manifest')
  const page = get('/identity-fixture/v1/identities?q=&limit=50')
  expect(page.items).toHaveLength(50); expect(page.items[0].id).toBe('unknown:source:0'); expect(page.uniqueBodySemantics).toBe('not-deduplicated')
  expect(get('/identity-fixture/v1/catalog/manifest')).toEqual(first)
  const next = get('/identity-fixture/v1/identities?q=&limit=50&pageToken=next')
  expect(next.items[0].id).toBe('unknown:source:50'); expect(next.nextPageToken).toBe('')
  expect(get('/identity-fixture/v1/catalog/manifest').inventoryManifestSha256).not.toBe(first.inventoryManifestSha256)
  expect(verifyNativeIdentityTraffic(traffic).requests).toBe(5)
  expect(() => verifyNativeIdentityTraffic([...traffic, { method: 'POST', path: '/identity-fixture/v1/state/plan', status: 200, bytes: 1 }])).toThrow()
  expect(reply('POST', '/identity-fixture/v1/state/plan').status).toBe(400)
})
