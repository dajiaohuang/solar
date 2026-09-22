import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Source-ingestion JavaScript tool has no declaration file.
import { covarianceUrl, fetchCovariance } from '../../scripts/fetch-sbdb-covariance.mjs'

const directories: string[] = []
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'solar-sbdb-covariance-'))
  directories.push(directory)
  return directory
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !directory.includes('solar-sbdb-covariance-')) throw new Error('Unexpected test cleanup path')
    await rm(directory, { recursive: true, force: true })
  }
})
const sourceBytes = () => readFile(new URL('../fixtures/sbdb-eros-covariance.json', import.meta.url))

describe('bounded immutable SBDB covariance ingestion', () => {
  it('requests one full-precision matrix and writes source-addressed evidence', async () => {
    const bytes = await sourceBytes(), directory = await temporaryDirectory()
    const fetcher = vi.fn(async () => new Response(bytes))
    const result = await fetchCovariance(' 433 ', directory, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('https://ssd-api.jpl.nasa.gov/sbdb.api?des=433&cov=mat&full-prec=1&phys-par=1&orbit-defs=1&nv-fmt=jd',
      { redirect: 'error', signal: expect.any(AbortSignal) })
    expect(await readFile(result.sourcePath)).toEqual(bytes)
    const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'))
    expect(receipt.sourceSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(receipt.sourceBytes).toBe(bytes.byteLength)
    expect(receipt.audit.solutionEpochTdb).toBe(2453311.5)
    expect(receipt.boundary).toMatch(/No state propagation/)
    const repeated = await fetchCovariance('433', directory, fetcher)
    expect(repeated.sourcePath).toBe(result.sourcePath)
    expect(await readFile(result.receiptPath, 'utf8')).toBe(JSON.stringify(receipt, null, 2) + '\n')
  })

  it('does not replace altered bytes at an existing immutable source path', async () => {
    const bytes = await sourceBytes(), directory = await temporaryDirectory()
    const hash = createHash('sha256').update(bytes).digest('hex'), path = join(directory, `${hash}.json`)
    await writeFile(path, 'preserve existing data')
    await expect(fetchCovariance('433', directory, async () => new Response(bytes))).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe('preserve existing data')
    expect(await readdir(directory)).toEqual([`${hash}.json`])
  })

  it('cancels an oversized response before writing artifacts', async () => {
    const directory = await temporaryDirectory(), cancel = vi.fn()
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)) }, cancel })
    await expect(fetchCovariance('433', directory, async () => new Response(stream))).rejects.toThrow(/exceeds/)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(await readdir(directory)).toEqual([])
  })

  it.each([
    ['HTTP failure', () => new Response('', { status: 503 })],
    ['ambiguous result', () => Response.json({ code: 300, list: [{ pdes: '433' }] })],
    ['invalid UTF-8', () => new Response(new Uint8Array([0xc3, 0x28]))],
    ['invalid JSON', () => new Response('{')],
  ])('rejects %s without writing data', async (_name, response) => {
    const directory = await temporaryDirectory()
    await expect(fetchCovariance('433', directory, async () => response())).rejects.toThrow()
    expect(await readdir(directory)).toEqual([])
  })

  it('escapes designations and rejects empty, oversized or control-bearing inputs', () => {
    const url = new URL(covarianceUrl('73P-C&cov=src'))
    expect(url.searchParams.get('des')).toBe('73P-C&cov=src')
    expect(url.searchParams.get('cov')).toBe('mat')
    for (const invalid of ['', ' ', '433\n', 'x'.repeat(81), null]) expect(() => covarianceUrl(invalid)).toThrow(/unambiguous/)
  })
})
