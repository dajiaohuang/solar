import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { columns, parseCount, parseSources, queries, sha256, spatialChunks } from '../../scripts/lib/gaia-dr3.mjs'
import { retrieveGaiaCone } from '../../scripts/fetch-gaia-cone.mjs'
import { decodeGaiaManifest } from '../../src/lib/gaiaChunks'

const root = 'tests/fixtures/gaia-pleiades-20260923/'
const manifest = JSON.parse(await readFile(root+'manifest.json', 'utf8'))
const countBytes = await readFile(root+'count.csv'), rowBytes = await readFile(root+'rows.csv')

function asyncTapFetcher(onPhase?: () => void | Promise<void>) {
  const jobs = new Map<string, boolean>()
  let nextJob = 0, disconnectPhaseOnce = true
  const fetcher = vi.fn(async (input: URL, init: RequestInit = {}) => {
    const url = new URL(String(input)), method = (init.method ?? 'GET').toUpperCase()
    if (url.pathname === '/tap-server/tap/async' && method === 'POST') {
      const form = new URLSearchParams(String(init.body)), countQuery = form.get('QUERY')!.includes('COUNT(*)')
      const id = `job-${++nextJob}`; jobs.set(id, countQuery)
      return new Response(null,{status:303,headers:{location:`/tap-server/tap/async/${id}`}})
    }
    if (url.pathname.endsWith('/phase')) {
      await onPhase?.()
      if (disconnectPhaseOnce) {
        disconnectPhaseOnce = false
        throw new TypeError('fetch failed',{cause:Object.assign(new Error('socket closed'),{code:'UND_ERR_SOCKET'})})
      }
      return new Response('COMPLETED')
    }
    if (url.pathname.endsWith('/results/result')) {
      const id = url.pathname.split('/').at(-3)!
      return new Response(jobs.get(id) ? countBytes : rowBytes,{headers:{'Content-Type':'text/csv'}})
    }
    if (method === 'DELETE') return new Response(null,{status:204})
    throw new Error(`Unexpected Gaia TAP request: ${method} ${url}`)
  })
  return fetcher
}

test('real ESA source count and Float64 records retain exact string IDs and source bytes', async () => {
  for (const entry of [...manifest.sources, ...manifest.chunks]) {
    const bytes = await readFile(root+entry.path); expect(bytes.length).toBe(entry.bytes); expect(sha256(bytes)).toBe(entry.sha256)
  }
  const count = parseCount(countBytes, 1024), rows = parseSources(rowBytes, manifest.settings, count)
  expect(count).toBe(19); expect(rows[0].source_id).toBe('65212004581252736')
  expect(typeof rows[0].source_id).toBe('string')
  expect(rows[0].ra).toBe(56.6929147034245)
  expect(spatialChunks(rows)[0]).toEqual(JSON.parse(await readFile(root+manifest.chunks[0].path, 'utf8')))
})
test('rejects truncated, duplicated, out-of-cone and invalid uncertainty rows', () => {
  const lines = rowBytes.toString().trimEnd().split('\n')
  for (const mutate of [
    (v: string[]) => v.pop(),
    (v: string[]) => { v[2] = v[1] },
    (v: string[]) => { const row = v[1].split(','); row[columns.indexOf('ra')] = '200'; v[1] = row.join(',') },
    (v: string[]) => { const row = v[1].split(','); row[columns.indexOf('ra_error')] = '-1'; v[1] = row.join(',') },
    (v: string[]) => { const row = v[1].split(','); row[columns.indexOf('ra_dec_corr')] = '1.1'; v[1] = row.join(',') },
  ]) { const changed = [...lines]; mutate(changed); expect(() => parseSources(Buffer.from(changed.join('\n')), manifest.settings, 19)).toThrow() }
  expect(() => parseCount(countBytes, 18)).toThrow(/budget/)
  expect(() => queries({ ...manifest.settings, radiusDeg: Infinity })).toThrow()
})
test('retains null measurements and negative parallax without deriving distance', () => {
  const lines = rowBytes.toString().trimEnd().split('\n'), row = lines[1].split(',')
  row[columns.indexOf('parallax')] = '-0.5'; row[columns.indexOf('radial_velocity')] = ''; lines[1] = row.join(',')
  const first = parseSources(Buffer.from(lines.join('\n')), manifest.settings, 19)[0]
  expect(first.parallax).toBe(-0.5); expect(first.radial_velocity).toBeNull(); expect(first).not.toHaveProperty('distance')
})
test('locally sorts unordered source rows by exact integer identity', () => {
  const lines = rowBytes.toString().trimEnd().split('\n'), reordered = [lines[0], ...lines.slice(1).reverse()]
  const stable = parseSources(rowBytes,manifest.settings,19), shuffled = parseSources(Buffer.from(reordered.join('\n')),manifest.settings,19)
  expect(shuffled).toEqual(stable)
  expect(shuffled.map(row => row.source_id)).toEqual([...shuffled.map(row => row.source_id)].sort((a,b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0))
})
test('wrap and polar bins preserve actual coordinates', () => {
  const chunks = spatialChunks([{ source_id: '1', ra: 359.9, dec: 90 }, { source_id: '2', ra: 0, dec: -90 }])
  expect(chunks.map((c: {key: string}) => c.key)).toEqual(['r0-d0', 'r71-d35'])
})
test('TOP plus one supplies bounded row-count evidence without a second archive scan', async () => {
  const fetcher = asyncTapFetcher()
  const result = await retrieveGaiaCone(manifest.settings, { fetcher })
  expect(result.rows).toHaveLength(19); expect(result.countSource).toBeUndefined()
  const submitted = fetcher.mock.calls.filter(call => call[1].method === 'POST')
  expect(submitted).toHaveLength(1)
  const form = new URLSearchParams(String(submitted[0][1].body))
  expect(form.get('MAXREC')).toBe(String(manifest.settings.maxRows+1))
  expect(form.get('QUERY')).toContain(`SELECT TOP ${manifest.settings.maxRows+1}`)
  expect(form.get('QUERY')).not.toMatch(/ORDER BY/i)
})

test('persists the exact UWS job and resumes it without submitting a duplicate query', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-gaia-resume-')), receiptPath = join(directory, 'rows.tap-job.json')
  try {
    const initialFetcher = asyncTapFetcher(async () => {
      const inFlightReceipt = JSON.parse(await readFile(receiptPath, 'utf8'))
      expect(inFlightReceipt.queryName).toBe('rows')
    })
    await retrieveGaiaCone(manifest.settings, { fetcher: initialFetcher, jobReceiptPath: receiptPath })
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    expect(receipt.format).toBe('solar-gaia-tap-job-v1')
    expect(receipt.queryName).toBe('rows'); expect(receipt.jobUrl).toMatch(/\/tap\/async\/job-1$/)
    expect(receipt.settings).toEqual(manifest.settings)

    const resumeFetcher = vi.fn(async (input: URL, init: RequestInit = {}) => {
      const url = new URL(String(input)), method = (init.method ?? 'GET').toUpperCase()
      if (url.pathname.endsWith('/phase')) return new Response('COMPLETED')
      if (url.pathname.endsWith('/results/result')) return new Response(rowBytes, { headers: { 'Content-Type': 'text/csv' } })
      if (method === 'DELETE') return new Response(null, { status: 204 })
      throw new Error(`Unexpected Gaia resume request: ${method} ${url}`)
    })
    const resumed = await retrieveGaiaCone(manifest.settings, { fetcher: resumeFetcher, resumeJobReceiptPath: receiptPath })
    expect(resumed.rows).toHaveLength(manifest.rows); expect(resumed.rowSource.resumedFromReceipt).toBe(true)
    expect(resumeFetcher.mock.calls.filter(call => call[1].method === 'POST')).toHaveLength(0)

    const mismatchFetcher = vi.fn()
    await expect(retrieveGaiaCone({ ...manifest.settings, maxRows: manifest.settings.maxRows+1 }, { fetcher: mismatchFetcher, resumeJobReceiptPath: receiptPath }))
      .rejects.toThrow(/does not match/)
    expect(mismatchFetcher).not.toHaveBeenCalled()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('keeps completed Gaia rows when remote job deletion cannot be confirmed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-gaia-cleanup-')), receiptPath = join(directory, 'rows.tap-job.json')
  let deleteAttempts = 0
  const fetcher = vi.fn(async (input: URL, init: RequestInit = {}) => {
    const url = new URL(String(input)), method = (init.method ?? 'GET').toUpperCase()
    if (url.pathname === '/tap-server/tap/async' && method === 'POST') {
      return new Response(null, { status: 303, headers: { location: '/tap-server/tap/async/job-cleanup-pending' } })
    }
    if (url.pathname.endsWith('/phase')) return new Response('COMPLETED')
    if (url.pathname.endsWith('/results/result')) return new Response(rowBytes, { headers: { 'Content-Type': 'text/csv' } })
    if (method === 'DELETE') { deleteAttempts++; return new Response(null, { status: 500 }) }
    throw new Error(`Unexpected Gaia cleanup request: ${method} ${url}`)
  })
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const result = await retrieveGaiaCone(manifest.settings, { fetcher, jobReceiptPath: receiptPath })
    expect(result.rows).toHaveLength(manifest.rows)
    expect(result.rowSource.cleanupPending).toBe(true)
    expect(deleteAttempts).toBe(4)
    expect(JSON.parse(await readFile(receiptPath, 'utf8')).jobUrl).toMatch(/job-cleanup-pending$/)
  } finally {
    report.mockRestore()
    await rm(directory, { recursive: true, force: true })
  }
})

test('retains a saved UWS receipt without deleting a job when polling fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-gaia-pending-')), receiptPath = join(directory, 'rows.tap-job.json')
  try {
    const fetcher = vi.fn(async (input: URL, init: RequestInit = {}) => {
      const url = new URL(String(input)), method = (init.method ?? 'GET').toUpperCase()
      if (url.pathname === '/tap-server/tap/async' && method === 'POST') return new Response(null, { status: 303, headers: { location: '/tap-server/tap/async/job-retained' } })
      if (url.pathname.endsWith('/phase')) throw new Error('simulated phase read failure')
      if (method === 'DELETE') return new Response(null, { status: 204 })
      throw new Error(`Unexpected Gaia retained-job request: ${method} ${url}`)
    })
    await expect(retrieveGaiaCone(manifest.settings, { fetcher, jobReceiptPath: receiptPath })).rejects.toThrow(/phase read failure/)
    expect(JSON.parse(await readFile(receiptPath, 'utf8')).jobUrl).toMatch(/job-retained$/)
    expect(fetcher.mock.calls.filter(call => call[1].method === 'DELETE')).toHaveLength(0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('sentinel manifest evidence is exact and legacy independent-count receipts remain supported', () => {
  const current = { ...manifest, rowCountEvidence: { method: 'top-plus-one-sentinel', limit: manifest.settings.maxRows+1, returnedRows: manifest.rows, overflow: false } }
  delete current.queryCountMatched
  expect(decodeGaiaManifest(new TextEncoder().encode(JSON.stringify(current))).rows).toBe(19)
  expect(decodeGaiaManifest(new TextEncoder().encode(JSON.stringify(manifest))).rows).toBe(19)
  for (const rowCountEvidence of [
    { ...current.rowCountEvidence, limit: current.settings.maxRows },
    { ...current.rowCountEvidence, returnedRows: current.rows+1 },
    { ...current.rowCountEvidence, overflow: true },
  ]) {
    expect(() => decodeGaiaManifest(new TextEncoder().encode(JSON.stringify({ ...current, rowCountEvidence })))).toThrow()
  }
})

test('optional count audit precedes rows, overbudget avoids the row query and cancellation cleans up', async () => {
  const fetcher = asyncTapFetcher()
  const result = await retrieveGaiaCone(manifest.settings, { fetcher, verifyCount: true })
  expect(result.rows).toHaveLength(19); expect(fetcher.mock.calls.filter(call => call[1].method === 'POST')).toHaveLength(2)
  expect(fetcher.mock.calls.filter(call => call[1].method === 'DELETE')).toHaveLength(2)
  fetcher.mockClear()
  await expect(retrieveGaiaCone({ ...manifest.settings, maxRows: 18 }, { fetcher, verifyCount: true })).rejects.toThrow(/budget/)
  expect(fetcher.mock.calls.filter(call => call[1].method === 'POST')).toHaveLength(1)
  const abort = new AbortController()
  await expect(retrieveGaiaCone(manifest.settings, { signal: abort.signal, fetcher: async (url, init) => {
    const response = await fetcher(url as URL, init)
    if (init?.method === 'POST') abort.abort()
    return response
  } })).rejects.toBeDefined()
})
