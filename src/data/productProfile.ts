export type ProductProfile = 'full' | 'preview'

/** Product availability is separate from scientific ephemeris delivery. */
export function productProfile(requested?: string): ProductProfile {
  if (requested !== undefined && requested !== 'full' && requested !== 'preview') throw new Error(`Unknown product profile ${requested}`)
  return requested ?? 'full'
}
