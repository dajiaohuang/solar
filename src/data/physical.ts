export const BODY_PHYSICAL: Record<string, { massKg: number; radiusKm: number }> = {
  sun: { massKg: 1.98847e30, radiusKm: 695700 },
  mercury: { massKg: 3.3011e23, radiusKm: 2439.7 },
  venus: { massKg: 4.8675e24, radiusKm: 6051.8 },
  earth: { massKg: 5.97237e24, radiusKm: 6371.0 },
  moon: { massKg: 7.342e22, radiusKm: 1737.4 },
  mars: { massKg: 6.4171e23, radiusKm: 3389.5 },
  jupiter: { massKg: 1.8982e27, radiusKm: 69911 },
  saturn: { massKg: 5.6834e26, radiusKm: 58232 },
  uranus: { massKg: 8.6810e25, radiusKm: 25362 },
  neptune: { massKg: 1.02413e26, radiusKm: 24622 },
  ceres: { massKg: 9.3835e20, radiusKm: 469.7 },
  pluto: { massKg: 1.303e22, radiusKm: 1188.3 },
}
export const BODY_ENGLISH_NAMES: Record<string, string> = {
  sun: 'Sun', mercury: 'Mercury', venus: 'Venus', earth: 'Earth', moon: 'Moon', mars: 'Mars',
  jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune', ceres: 'Ceres',
  pluto: 'Pluto', eris: 'Eris', haumea: 'Haumea', makemake: 'Makemake', io: 'Io', europa: 'Europa',
  ganymede: 'Ganymede', callisto: 'Callisto', titan: 'Titan',
}
