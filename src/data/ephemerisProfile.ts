/** Delivery capacity is not astronomical coverage. Native defaults to full;
 * Pages defaults to its declared compact windows. An override is explicit. */
export function ephemerisProfile(target?: string, requested?: string): 'pages' | 'full' {
  const profile = requested ?? (target === 'native' ? 'full' : 'pages')
  if (profile !== 'pages' && profile !== 'full') throw new Error(`Unknown ephemeris profile ${profile}`)
  return profile
}
