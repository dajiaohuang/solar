export const JUNO_RECONSTRUCTION = Object.freeze({
  id: 'juno',
  name: 'Juno',
  naifId: -61,
  centerNaifId: 5,
  sourceUrl: 'https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/spk/juno_rec_orbit.bsp',
  readmeUrl: 'https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/aareadme.txt',
  orbitTableUrl: 'https://naif.jpl.nasa.gov/pub/naif/JUNO/kernels/spk/juno_rec_orbit.orb',
  coreKernelId: 'de440s-2000-01-01-2051-01-01',
  startUtcJulianDay: 2459580.5,
  endEt: 840884700,
  startLabel: '2022-01-01 UTC converted to TDB',
  endLabel: '2026-08-24 source descriptor end (TDB)',
  solution: 'juno-reconstruction-2022-2026-with-de440s-origin',
})

export const JUNO_IMPLEMENTATION_PATHS = Object.freeze([
  'scripts/lib/juno-source-set.mjs',
  'scripts/prepare-juno-reconstruction.mjs',
  'scripts/integrate-juno-reconstruction.mjs',
  'scripts/crop-spk.mjs',
  'scripts/lib/kernel-window-coverage.mjs',
  'src/engine/ephemeris/spk.ts',
  'src/engine/ephemeris/spkType21.ts',
  'src/engine/ephemeris/spkType17.ts',
  'src/engine/ephemeris/timeScales.ts',
  'src/data/spacecraftIdentities.ts',
])
