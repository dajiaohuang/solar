import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fetchHorizonsSpk } from '../../scripts/lib/horizons-spk.mjs'

const bytes = readFileSync('tests/fixtures/spk21-horizons-eris.bsp')
const request = { designation: '136199', target: 20136199, from: '2020-01-01', to: '2031-01-01' }
const payload = { signature: { source: 'NASA/JPL Horizons API', version: '1.2' }, spk_file_id: '20136199', spk: bytes.toString('base64'), result: 'fixture' }
afterEach(() => vi.unstubAllGlobals())

describe('explicit Horizons SPK retrieval', () => {
  it('records source identity and decodes only the requested target', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload)))
    vi.stubGlobal('fetch', fetcher)
    const result = await fetchHorizonsSpk(request)
    expect(result.buffer).toEqual(bytes)
    expect(result.source).toMatchObject({ target: request.target, timeScale: 'TDB', bytes: bytes.length })
    expect(result.source.sha256).toMatch(/^[a-f0-9]{64}$/)
    const url = new URL(fetcher.mock.calls[0][0])
    expect(url.origin).toBe('https://ssd.jpl.nasa.gov')
    expect(url.searchParams.get('COMMAND')).toBe("'136199;'")
    expect(url.searchParams.get('EPHEM_TYPE')).toBe('SPK')
  })
  it.each(['2020-02-31', '2021-02-29', 'not-a-date', '2020-1-1'])('rejects invalid date %s without contacting the API', async (from) => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(fetchHorizonsSpk({ ...request, from })).rejects.toThrow(/calendar/)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    { signature: { source: 'other', version: '1.2' } },
    { signature: { source: 'NASA/JPL Horizons API', version: '9' } },
    { spk_file_id: '20136108' }, { error: 'No matching target' },
    { spk: '*' }, { spk: 'AAAA' },
  ])('fails closed on API signature, target, error, or binary corruption', async (patch) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...payload, ...patch }))))
    await expect(fetchHorizonsSpk(request)).rejects.toThrow()
  })
  it('rejects failed HTTP and missing bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
    await expect(fetchHorizonsSpk(request)).rejects.toThrow(/HTTP 503/)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null)))
    await expect(fetchHorizonsSpk(request)).rejects.toThrow(/body/)
  })
})
