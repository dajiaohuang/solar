/** Reviewed identities only; neither a trajectory nor a kernel-admission list.
 * https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/naif_ids.html
 */
export const SPACECRAFT_IDENTITY_SOURCE = 'https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/naif_ids.html'
export const SPACECRAFT_IDENTITIES = [
  { id: 'voyager1', naifId: -31, name: 'Voyager 1' },
  { id: 'voyager2', naifId: -32, name: 'Voyager 2' },
  { id: 'newhorizons', naifId: -98, name: 'New Horizons' },
  { id: 'juno', naifId: -61, name: 'Juno' },
  { id: 'cassini', naifId: -82, name: 'Cassini' },
  { id: 'messenger', naifId: -236, name: 'MESSENGER' },
] as const
