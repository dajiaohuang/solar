import evidence from '../pck00011.source.json' with { type: 'json' }

export const PCK_RADII_SOURCE = Object.freeze({ ...evidence })
export type BodyRadii = {
  naifPckId: number
  radiiKm: [number, number, number]
  representation: 'sphere' | 'triaxial-ellipsoid'
  uncertaintyKm: null
}

/** Reads only the pinned, unmodified PCK. This is not a general kernel parser:
 * incremental assignments, expressions and external kernel overrides are absent
 * from the accepted source. Comments and their historical/example radii are not data. */
export async function readPinnedPckData(input: ArrayBuffer) {
  if (input.byteLength !== evidence.bytes) throw new RangeError('PCK source size mismatch')
  const bytes = input.slice(0)
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
  if (hash !== evidence.sha256) throw new RangeError('PCK source checksum mismatch')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const blocks: string[] = []
  let active = false
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '\\begindata') active = true
    else if (line.trim() === '\\begintext') active = false
    else if (active) blocks.push(line)
  }
  return blocks.join('\n')
}

export async function loadPckRadii(input: ArrayBuffer) {
  const data = await readPinnedPckData(input)
  const bodies = new Map<number, BodyRadii>()
  for (const match of data.matchAll(/\bBODY(\d+)_RADII\s*=\s*\(([^)]*)\)/g)) {
    const naifPckId = Number(match[1])
    const values = match[2].trim().split(/\s+/).map(token => Number(token.replace(/[dD]/, 'E')))
    if (!Number.isSafeInteger(naifPckId) || bodies.has(naifPckId) || values.length !== 3 || values.some(value => !Number.isFinite(value) || value <= 0)) throw new RangeError('Invalid pinned PCK radius assignment')
    bodies.set(naifPckId, { naifPckId, radiiKm: values as [number, number, number],
      representation: values.every(value => value === values[0]) ? 'sphere' : 'triaxial-ellipsoid', uncertaintyKm: null })
  }
  if (!bodies.size) throw new RangeError('Pinned PCK contains no radii')
  return {
    source: PCK_RADII_SOURCE,
    ids: () => Array.from(bodies.keys()).sort((a, b) => a-b),
    get: (id: number): BodyRadii | null => {
      const body = bodies.get(id)
      return body ? { ...body, radiiKm: [...body.radiiKm] } : null
    },
    limitations: [
      'Source ellipsoid axes in km, not apparent angular radii, limb topography, atmosphere or ring extents.',
      'Equal source axes specify a spherical approximation, not proof that the actual body is spherical.',
      'No radius uncertainty is supplied by this loader; null is unknown, not zero.',
      'PCK IDs are retained exactly; aliases to SPK/catalog IDs require an explicit identity mapping.',
      'Orientation models are not evaluated here. Precise terrestrial/lunar orientation requires the appropriate higher-accuracy sources.',
      'Historical examples and commented-out radii are excluded; source references and caveats remain in the original kernel.',
    ],
  }
}
