export const DE440_DYNAMICS_SOURCE = Object.freeze({
  id: 'de440s-2000-01-01-2051-01-01',
  path: 'de440s-2000-01-01-2051-01-01.bsp',
  sha256: '8724d2d1bac115a75ad1f984c5b474ca778c96ee8be2df83e624cef61c001069',
  bytes: 5558272, startEt: -43200, endEt: 1609416000,
  source: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp',
  gmSha256: '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140',
  gmSource: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc',
})
// Earth and Moon are separated; their system barycenter is never another mass.
// Other systems are represented by their total GM at the system barycenter.
export const DE440_FORCE_IDS = Object.freeze([10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9])
