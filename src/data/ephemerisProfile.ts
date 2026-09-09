/** Delivery capacity is not astronomical coverage. Pages is the default Web
 * delivery profile; an explicit override selects the full Web profile. */
export function ephemerisProfile(requested?: string): 'pages' | 'full' {
  const profile = requested ?? 'pages'
  if (profile !== 'pages' && profile !== 'full') throw new Error(`Unknown ephemeris profile ${profile}`)
  return profile
}
