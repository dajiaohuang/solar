import type { GaiaChunk } from './gaiaChunks'
import capacity from '../data/gaiaCapacity.json'

/** Gnomonic tangent projection. Only display offsets are rounded to Float32;
 * the original ICRS source rows and direction vectors remain untouched. */
export function projectGaiaDisplay(chunk: GaiaChunk, centerRaDeg: number, centerDecDeg: number, radiusDeg: number) {
  if (![centerRaDeg, centerDecDeg, radiusDeg].every(Number.isFinite) || centerRaDeg < 0 || centerRaDeg >= 360 || Math.abs(centerDecDeg) > 90 || radiusDeg <= 0 || radiusDeg > 2) throw new Error('Invalid Gaia tangent view')
  if (chunk.sources.length > capacity.maxChunkRows || chunk.directionsICRS.length !== chunk.sources.length*3) throw new Error('Invalid Gaia projection row budget or direction shape')
  const ra = centerRaDeg*Math.PI/180, dec = centerDecDeg*Math.PI/180, scale = Math.tan(radiusDeg*Math.PI/180)*1.1
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Gaia tangent scale is not representable')
  const center = [Math.cos(dec)*Math.cos(ra), Math.cos(dec)*Math.sin(ra), Math.sin(dec)]
  const east = [-Math.sin(ra), Math.cos(ra), 0], north = [-Math.sin(dec)*Math.cos(ra), -Math.sin(dec)*Math.sin(ra), Math.cos(dec)]
  const display = new Float32Array(chunk.sources.length*3)
  for (let i = 0; i < chunk.sources.length; i++) {
    const x = chunk.directionsICRS[i*3], y = chunk.directionsICRS[i*3+1], z = chunk.directionsICRS[i*3+2], denominator = x*center[0]+y*center[1]+z*center[2]
    if (!(denominator > 0)) throw new Error('Gaia source is behind the tangent plane')
    // East is left on a conventional sky chart; north is up.
    display[i*3] = -(x*east[0]+y*east[1]+z*east[2])/denominator/scale
    display[i*3+1] = (x*north[0]+y*north[1]+z*north[2])/denominator/scale
    display[i*3+2] = chunk.sources[i].phot_g_mean_mag
    if (!Number.isFinite(display[i*3]) || !Number.isFinite(display[i*3+1]) || !Number.isFinite(display[i*3+2])) {
      throw new Error('Gaia display values exceed finite Float32 representation')
    }
  }
  return display
}
