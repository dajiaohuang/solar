import { describe, expect, it } from 'vitest'
import { parseSourceScene, requireSourcePin, sourcePinFor, sourceRecordBody, sourceSceneFromPage } from '../../src/lib/sourceScene'
import type { SourceIdentityPage } from '../../src/lib/sourceIdentityPage'

const page: SourceIdentityPage = {
  manifest: {
    apiVersion: 'solar.api/v1', catalogVersion: 'catalog-v1',
    catalogManifestSha256: 'a'.repeat(64), inventoryManifestSha256: 'b'.repeat(64),
  },
  query: '', totalRecords: 2, limit: 50, nextPageToken: null,
  items: [
    { id: 'source,one', name: 'One', designation: '1', category: 'asteroid', source: 'fixture', sourceRow: 1, identityStatus: 'unmapped', ephemerisStatus: 'missing' },
    { id: 'source:two', name: 'Two', designation: '2', category: 'comet', source: 'fixture', sourceRow: 2, identityStatus: 'unmapped', ephemerisStatus: 'missing' },
  ],
}

describe('source scene identity pins', () => {
  it('keeps raw IDs and manifests without inventing physical fields', () => {
    const identity = sourceSceneFromPage(page)
    expect(identity.ids).toEqual(['source,one', 'source:two'])
    expect(sourceRecordBody('source,one', page.items[0])).toMatchObject({ kind: 'sourceRecord', source: 'source-inventory' })
    expect(sourceRecordBody('source,one', page.items[0])).not.toHaveProperty('orbit')
    expect(sourcePinFor(identity, 'https://api.example/')).toMatchObject({ base: 'https://api.example' })
  })

  it('rejects duplicate or malformed identities and fails closed on manifest drift', () => {
    const encoded = JSON.stringify({ ...sourceSceneFromPage(page), ids: ['source:one', 'source:one'] })
    expect(() => parseSourceScene(encoded)).toThrow()
    const identity = sourceSceneFromPage(page)
    const pin = sourcePinFor(identity, 'https://api.example')
    expect(() => requireSourcePin(pin, 'https://api.example', page.manifest)).not.toThrow()
    expect(() => requireSourcePin(pin, 'https://api.example', { ...page.manifest, inventoryManifestSha256: 'c'.repeat(64) })).toThrow('snapshot changed')
  })
})
