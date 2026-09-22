import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/visibility-api-sun.json'
import { loadGroundVisibility, validateGroundVisibility, type GroundVisibilityRequest } from '../../src/lib/groundVisibility'

const request = fixture.result.request as GroundVisibilityRequest
describe('source-backed visibility transport', () => {
  it('accepts the real Go/SPK/IERS response and retains source and search limits', async () => {
    let sent: RequestInit | undefined
    const result = await loadGroundVisibility('https://example.test', 'full', request, new AbortController().signal, (async (url, init) => {
      expect(url).toBe('https://example.test/v1/observation/windows'); sent = init
      const body = JSON.stringify(fixture)
      return new Response(body, { headers: { 'Content-Type': 'application/json', 'Content-Length': String(new TextEncoder().encode(body).length) } })
    }) as typeof fetch)
    expect(JSON.parse(sent!.body as string)).toEqual(request)
    expect(result.result.crossings.map(v => v.kind)).toEqual(['set', 'rise'])
    expect(result.result.contract.physicalUncertainty).toBe('not-propagated')
    expect(result.result.contract.continuousCoverageProven).toBe(false)
  })
  it.each([
    ['different target', (r: typeof fixture) => { r.result.request.bodyId = 'naif:301' }],
    ['different station', (r: typeof fixture) => { r.result.request.station.longitudeDeg = 0 }],
    ['different altitude', (r: typeof fixture) => { r.result.request.minAltitudeDeg = 5 }],
    ['invented continuous coverage', (r: typeof fixture) => { r.result.contract.continuousCoverageProven = true }],
    ['invalid boundary tolerance', (r: typeof fixture) => { r.result.crossings[0].bracketSeconds = 2 }],
    ['reversed window', (r: typeof fixture) => { r.result.windows[0].endSeconds = -1 }],
    ['changed source identity', (r: typeof fixture) => { r.result.sources[0].kernelSha256 = 'unknown' }],
  ])('rejects %s', (_name, mutate) => {
    const changed = structuredClone(fixture); mutate(changed)
    expect(() => validateGroundVisibility(changed, request)).toThrow(/contract mismatch/)
  })
  it('keeps preview offline and pre-aborted requests unissued', async () => {
    const fetcher = (() => { throw new Error('must not fetch') }) as typeof fetch
    await expect(loadGroundVisibility('https://example.test', 'preview', request, new AbortController().signal, fetcher)).rejects.toMatchObject({ code: 'backend_unavailable' })
    const cancelled = new AbortController(); cancelled.abort()
    await expect(loadGroundVisibility('https://example.test', 'full', request, cancelled.signal, fetcher)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
