export type ProductProfile = 'full' | 'preview'

/** Product availability is separate from scientific ephemeris delivery. */
export function productProfile(target?: string, requested?: string): ProductProfile {
  if (requested !== undefined && requested !== 'full' && requested !== 'preview') throw new Error(`Unknown product profile ${requested}`)
  if (target === 'native' && requested === 'preview') throw new Error('Native builds must not inherit Pages preview restrictions')
  return requested ?? 'full'
}
