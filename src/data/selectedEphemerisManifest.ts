import pages from './ephemeris-manifest.json'
import full from './ephemeris-manifest-full.json'
import { previewEphemerisManifest } from './previewEphemeris'

// The build-time constant lets Vite omit the unused static profile. Unit tools
// without Vite use Pages unless they explicitly construct the full pool.
const source = typeof __SOLAR_EPHEMERIS_PROFILE__ !== 'undefined' && __SOLAR_EPHEMERIS_PROFILE__ === 'full' ? full : pages
// Production receives the already-resolved manifest, allowing bundlers to omit
// full identity tables and unselected manifests from every scientific worker.
export const selectedEphemerisManifest = typeof __SOLAR_EPHEMERIS_MANIFEST__ !== 'undefined'
  ? __SOLAR_EPHEMERIS_MANIFEST__
  : typeof __SOLAR_PRODUCT_PROFILE__ !== 'undefined' && __SOLAR_PRODUCT_PROFILE__ === 'preview'
    ? previewEphemerisManifest(source) : source
