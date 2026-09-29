export const DE440_DYNAMICS_SOURCE = Object.freeze({
  id: 'de440s-2000-01-01-2051-01-01',
  path: 'de440s-2000-01-01-2051-01-01.bsp',
  sha256: '8724d2d1bac115a75ad1f984c5b474ca778c96ee8be2df83e624cef61c001069',
  bytes: 5558272, startEt: -43200, endEt: 1609416000,
  source: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp',
  sourceBytes: 32726016,
  sourceMd5: '3917ee56769db332790c751e2168843d',
  sourceLastModified: 'Mon, 21 Dec 2020 19:39:26 GMT',
  derivation: 'Solar Atlas crop-spk.mjs: exact original J2000 type-2/3 records for segments overlapping the bounded TDB window; no refit. Parent SHA-256 was not captured; parent identity uses its URL, byte count, Last-Modified value and NAIF-published MD5.',
  gmSha256: '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140',
  gmSource: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc',
})
// Earth and Moon are separated; their system barycenter is never another mass.
// Other systems are represented by their total GM at the system barycenter.
export const DE440_FORCE_IDS = Object.freeze([10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9])
