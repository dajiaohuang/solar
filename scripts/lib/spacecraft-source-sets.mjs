/** Target membership recorded in the full New Horizons OD164 SPK comments. */
export const SPACECRAFT_PACK_IMPLEMENTATION = Object.freeze([
  'scripts/prepare-spacecraft-pack.mjs',
  'scripts/integrate-spacecraft-pack.mjs',
  'scripts/crop-spk.mjs',
  'scripts/lib/kernel-window-coverage.mjs',
  'scripts/lib/spacecraft-source-sets.mjs',
  'src/engine/ephemeris/spk.ts',
  'src/engine/ephemeris/spkType21.ts',
  'src/engine/ephemeris/spkType17.ts',
  'src/data/spacecraftIdentities.ts',
])

export const NEW_HORIZONS_OD164_SOURCE_SET = Object.freeze({
  id: 'newhorizons-od164-de433',
  spacecraftId: 'newhorizons',
  spacecraftTarget: -98,
  memberTargets: Object.freeze([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    199, 299, 301, 399, 499, 2486958,
  ]),
})

/** Cassini Grand Finale NAV trajectory with its explicit SSB-to-Sun origin
 * target retained in the same reconstructed source. */
export const CASSINI_GRAND_FINALE = Object.freeze({
  spacecraftId: 'cassini',
  target: -82,
  center: 6,
  originTarget: 10,
  dependencyTargets: Object.freeze([6, 10]),
  file: '171214R_SCPSE_17224_17258.bsp',
  sourceUrl: 'https://naif.jpl.nasa.gov/pub/naif/pds/data/co-s_j_e_v-spice-6-v1.0/cosp_1000/data/spk/171214R_SCPSE_17224_17258.bsp',
  notesUrl: 'https://naif.jpl.nasa.gov/pub/naif/pds/data/co-s_j_e_v-spice-6-v1.0/cosp_1000/data/spk/spkinfo.txt',
  coverageStartEt: 555782400,
  coverageEndEt: 558743640,
})

/** MESSENGER final weekly reconstruction arc and its explicit Mercury/Sun
 * center chain. The adjacent earlier orbit arc is intentionally excluded at
 * its apoapsis boundary, where the source documents kilometer-scale jumps. */
export const MESSENGER_FINAL_ORBIT = Object.freeze({
  spacecraftId: 'messenger',
  target: -236,
  center: 1,
  rootCenters: Object.freeze([1, 2, 10, 399]),
  dependencyTargets: Object.freeze([1, 10]),
  originTarget: 10,
  file: 'msgr_040803_150430_150430_od431sc_2.bsp',
  sourceUrl: 'https://naif.jpl.nasa.gov/pub/naif/pds/data/mess-e_v_h-spice-6-v1.0/messsp_1000/data/spk/msgr_040803_150430_150430_od431sc_2.bsp',
  labelUrl: 'https://naif.jpl.nasa.gov/pub/naif/pds/data/mess-e_v_h-spice-6-v1.0/messsp_1000/data/spk/msgr_040803_150430_150430_od431sc_2.lbl',
  notesUrl: 'https://naif.jpl.nasa.gov/pub/naif/pds/data/mess-e_v_h-spice-6-v1.0/messsp_1000/data/spk/spkinfo.txt',
  sourceBytes: 684620800,
  sourceMd5: '8a82aaa12af6a4af394b71a8584784e0',
  maxSourceBytes: 768 * 1024 * 1024,
  coverageStartEt: 483015601,
  coverageEndEt: 483694028.35148823,
  impactUtc: '2015-04-30T19:26:01.166Z',
  consultedOn: '2026-09-29',
  boundary: 'KinetX/JHUAPL final reconstruction, restricted to its last continuous Type 1 arc starting one second after the 2015-04-22 apoapsis boundary and ending one second before its terminal epoch, which the source notes place at the estimated Mercury impact. Archive review also found three historical Type 1 segments with duplicate record-final epochs; those arcs are excluded, and the selected segment retains strict increasing-epoch validation. Earlier source arcs have documented kilometer-scale boundary discontinuities; no post-impact state is admitted. ORECON3 formal RTN position sigmas are a separate source and omit cross-axis covariance.',
})

/** Validate the cropped mission arc against its own center contract. */
export function validateSpacecraftOriginArc(segments, contract, startEt, endEt) {
  if (contract !== CASSINI_GRAND_FINALE && contract !== MESSENGER_FINAL_ORBIT) throw new Error('Unreviewed spacecraft origin contract')
  const targets = segments.filter(segment => segment.target === contract.target)
  if (!targets.length || targets.some(segment => segment.center !== contract.center || segment.frame !== 1 || segment.type !== 1)) {
    throw new Error(`${contract.spacecraftId} target is not the reviewed J2000 Type 1 reconstruction relative to center ${contract.center}`)
  }
  if (contract === MESSENGER_FINAL_ORBIT && !targets.some(segment => segment.startEt <= startEt && segment.endEt >= endEt)) {
    throw new Error('MESSENGER request is outside the reviewed final Mercury-barycenter Type 1 arc')
  }
}
