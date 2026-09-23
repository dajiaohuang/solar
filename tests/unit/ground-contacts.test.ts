import { expect, test, vi } from 'vitest'
import fixture from '../fixtures/ground-contacts-api-dallas.json'
import { loadGroundContacts, validateGroundContacts } from '../../src/lib/groundContacts'

const request = { ...fixture.result.request, aberration: 'CN' as const }
const jsonResponse = (value: unknown, status = 200) => {
  const body = JSON.stringify(value)
  return new Response(body, { status, headers: {
    'Content-Type': 'application/json',
    'Content-Length': String(new TextEncoder().encode(body).length),
  } })
}
test('captured loopback HTTP contacts retain real station, brackets and source identity', () => {
  const result = validateGroundContacts(fixture, request)
  expect(result.result.contacts).toHaveLength(4)
  expect(result.result.contacts[0].utc).toBe('2024-04-08T17:23:20.434570Z')
  expect(result.result.contract.physicalTimingUncertaintySeconds).toBeNull()
})
test('rejects mismatched station, unbounded brackets, source substitution and false completeness', () => {
  for (const mutate of [
    (v: typeof fixture) => { v.result.request.station.latitudeDeg = 0 },
    (v: typeof fixture) => { v.result.radiusSourceSha256 = 'b'.repeat(64) },
    (v: typeof fixture) => { v.result.possibleMissedEvents = false },
    (v: typeof fixture) => { v.result.contacts[0].bracketSeconds[0] = -1 },
    (v: typeof fixture) => { v.result.contacts[0].bracketUtc[0] = '2099-01-01T00:00:00.000000Z' },
    (v: typeof fixture) => { v.result.contacts.reverse() },
    (v: typeof fixture) => { v.result.sources.pop() },
    (v: typeof fixture) => { v.result.sources[0].kernelSha256 = 'unknown' },
    (v: typeof fixture) => { v.result.startGeometry.classification = 'total' },
    (v: typeof fixture) => { v.result.endGeometry.externalGapRadians = Infinity },
  ]) {
    const changed = structuredClone(fixture); mutate(changed)
    expect(() => validateGroundContacts(changed, request)).toThrow()
  }
})
test('transport blocks preview, retains source failures and cancels late responses', async () => {
  const fetcher = vi.fn(async () => jsonResponse(fixture))
  await expect(loadGroundContacts('/api', 'preview', request, new AbortController().signal, fetcher)).rejects.toMatchObject({ code: 'backend_unavailable' })
  expect(fetcher).not.toHaveBeenCalled()
  await expect(loadGroundContacts('/api', 'full', request, new AbortController().signal, fetcher)).resolves.toMatchObject({ result: { contacts: fixture.result.contacts } })
  const controller = new AbortController()
  await expect(loadGroundContacts('/api', 'full', request, controller.signal, vi.fn(async () => { controller.abort(); return fetcher() }))).rejects.toBeDefined()
  await expect(loadGroundContacts('/api', 'full', request, new AbortController().signal, vi.fn(async () => jsonResponse({ error: { code: 'body_radii_unavailable', message: 'PCK not configured' } }, 503)))).rejects.toMatchObject({ code: 'body_radii_unavailable' })
})
