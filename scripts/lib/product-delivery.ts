import { createHash } from 'node:crypto'
import preview from '../../src/data/preview-profile.json' with { type: 'json' }
import pages from '../../src/data/ephemeris-manifest.json' with { type: 'json' }
import full from '../../src/data/ephemeris-manifest-full.json' with { type: 'json' }
import { productProfile } from '../../src/data/productProfile.ts'
import { ephemerisProfile } from '../../src/data/ephemerisProfile.ts'
import { previewEphemerisManifest } from '../../src/data/previewEphemeris.ts'

export function jsonDocument(value: unknown) { return `${JSON.stringify(value, null, 2)}\n` }
export function sha256(value: string | Uint8Array) { return createHash('sha256').update(value).digest('hex') }

/** Build-only policy. Runtime imports the same deterministic SPK selector. */
export function productDelivery(requestedProduct?: string, requestedEphemeris?: string) {
  const product = productProfile(requestedProduct)
  const scientificProfile = ephemerisProfile(requestedEphemeris)
  const source = scientificProfile === 'full' ? full : pages
  const manifest = product === 'preview' ? previewEphemerisManifest(source) : source
  const availability = {
    schemaVersion: 1,
    productProfile: product,
    preview: product === 'preview' ? preview : null,
    ephemerisManifestId: manifest.id,
    ephemerisManifestSha256: sha256(jsonDocument(manifest)),
    sourceEphemerisProfile: scientificProfile,
  }
  const availabilitySha256 = sha256(jsonDocument(availability))
  return {
    product, scientificProfile, manifest, availability, availabilitySha256,
    // A trimmed manifest must NEVER replace an immutable full manifest at the
    // same URL: full and preview caches coexist by content-addressed path.
    catalogDirectory: product === 'preview' ? `data/asteroids/preview/${availabilitySha256}` : 'data/asteroids',
  }
}
