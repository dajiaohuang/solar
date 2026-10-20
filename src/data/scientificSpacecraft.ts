import { SPACECRAFT_IDENTITIES } from './spacecraftIdentities'
import type { CelestialBody } from '../types'

const PRESENTATION: Record<string, { name: string; color: string }> = {
  voyager1: { name: '旅行者 1 号', color: '#ffcc00' },
  voyager2: { name: '旅行者 2 号', color: '#66ccff' },
  newhorizons: { name: '新视野号', color: '#88ffcc' },
  juno: { name: '朱诺号', color: '#f49bff' },
  cassini: { name: '卡西尼号', color: '#ffc078' },
  messenger: { name: '信使号', color: '#8bd5ff' },
}

/** Canonical scientific selections, separate from the story overlay IDs.
 * No seed orbit or fallback coordinates: absent SPK coverage stays missing.
 */
export const SCIENTIFIC_SPACECRAFT: CelestialBody[] = SPACECRAFT_IDENTITIES.map(identity => ({
  id: `naif:${identity.naifId}`,
  naifId: identity.naifId,
  name: `${PRESENTATION[identity.id].name} · SPK`,
  shortName: `${identity.name} · SPK`,
  kind: 'spacecraft',
  color: PRESENTATION[identity.id].color,
  size: 3.5,
  source: 'jpl-spk',
  dataEpochLabel: 'Original SPK states only within admitted source coverage',
}))
