// NAIF body-center IDs. Never substitute a planetary-system barycenter for a
// named planet; center offsets must be supplied by the satellite SPK kernels.
export const BODY_NAIF_IDS: Record<string, number> = {
  sun: 10, mercury: 199, venus: 299, earth: 399, moon: 301,
  mars: 499, jupiter: 599, saturn: 699, uranus: 799, neptune: 899, pluto: 999,
  io: 501, europa: 502, ganymede: 503, callisto: 504, titan: 606,
  ceres: 2000001, pallas: 2000002, vesta: 2000004,
  phobos: 401, deimos: 402, amalthea: 505, thebe: 514, adrastea: 515, metis: 516,
  mimas: 601, enceladus: 602, tethys: 603, dione: 604, rhea: 605,
  hyperion: 607, iapetus: 608, phoebe: 609, helene: 612, telesto: 613, calypso: 614,
  ariel: 701, umbriel: 702, titania: 703, oberon: 704, miranda: 705,
  triton: 801, nereid: 802, charon: 901, nix: 902, hydra: 903, kerberos: 904, styx: 905,
}

export function bodyNaifId(body: { id: string; naifId?: number }): number | undefined {
  if (Number.isSafeInteger(body.naifId)) return body.naifId
  if (BODY_NAIF_IDS[body.id] !== undefined) return BODY_NAIF_IDS[body.id]
  // Only conventional numbered asteroid SPK IDs; unknown/provisional targets
  // need an explicit source ID rather than guesses from their display name.
  const number = /^asteroid:([1-9]\d*)$/.exec(body.id)?.[1]
  if (number && Number(number) < 1000000) return 2000000 + Number(number)
  return undefined
}
