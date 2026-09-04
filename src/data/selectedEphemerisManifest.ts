import pages from './ephemeris-manifest.json'
import full from './ephemeris-manifest-full.json'

// The build-time constant lets Vite omit the unused static profile. Unit tools
// without Vite use Pages unless they explicitly construct the full pool.
export const selectedEphemerisManifest = typeof __SOLAR_EPHEMERIS_PROFILE__ !== 'undefined' && __SOLAR_EPHEMERIS_PROFILE__ === 'full' ? full : pages
