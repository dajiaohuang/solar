import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Build-only JavaScript helper has no declaration file.
import { fetchArtifactBytes } from '../../scripts/lib/fetch-artifact-bytes.mjs'

describe('raw delivery verification', () => {
  it('hashes encoded bytes even when a static server declares Content-Encoding', async () => {
    const encoded = gzipSync('scientific-source-fixture')
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Encoding': 'gzip' })
      response.end(encoded)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture server')
      const url = `http://127.0.0.1:${address.port}/sample.json.gz`
      expect(await fetchArtifactBytes(url, encoded.length)).toEqual(encoded)
      await expect(fetchArtifactBytes(url, encoded.length - 1)).rejects.toThrow(/byte limit/)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
  it('rejects invalid transport and unbounded artifact sizes', () => {
    expect(() => fetchArtifactBytes('file:///fixture', 100)).toThrow(/HTTP/)
    expect(() => fetchArtifactBytes('https://example.invalid/', -1)).toThrow(/byte limit/)
  })
})
