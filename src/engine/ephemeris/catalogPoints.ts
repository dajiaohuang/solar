import { solveEllipticKeplerRadians } from './kepler'

const RAD = Math.PI / 180
export const CATALOG_ELEMENT_STRIDE = 8

export function propagateCatalogElementPositions(
  elements: Float64Array,
  julianDay: number,
  onProgress?: (progress: number) => void,
) {
  if (elements.length % CATALOG_ELEMENT_STRIDE !== 0) throw new Error('Catalog element buffer has an invalid stride')
  const count = elements.length / CATALOG_ELEMENT_STRIDE
  const positions = new Float32Array(count * 2)
  const positions3D = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const offset = index * CATALOG_ELEMENT_STRIDE
    const epochJd = elements[offset]
    const semiMajorAxisAU = elements[offset + 1]
    const eccentricity = elements[offset + 2]
    if (!(semiMajorAxisAU > 0) || !Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1) {
      throw new Error(`Catalog record ${index} is not a supported elliptic orbit`)
    }
    const inclination = elements[offset + 3] * RAD
    const ascendingNode = elements[offset + 4] * RAD
    const argPeriapsis = elements[offset + 5] * RAD
    const meanAnomaly = (elements[offset + 6] + elements[offset + 7] * (julianDay - epochJd)) * RAD
    let eccentricAnomaly: number
    try {
      eccentricAnomaly = solveEllipticKeplerRadians(meanAnomaly, eccentricity)
    } catch (error) {
      throw new RangeError(`Catalog record ${index} failed elliptic Kepler propagation`, { cause: error })
    }
    const orbitalX = semiMajorAxisAU * (Math.cos(eccentricAnomaly) - eccentricity)
    const orbitalY = semiMajorAxisAU * Math.sqrt(1 - eccentricity ** 2) * Math.sin(eccentricAnomaly)
    const cosW = Math.cos(argPeriapsis), sinW = Math.sin(argPeriapsis)
    const cosO = Math.cos(ascendingNode), sinO = Math.sin(ascendingNode), cosI = Math.cos(inclination), sinI = Math.sin(inclination)
    const x = (cosW * cosO - sinW * sinO * cosI) * orbitalX +
      (-sinW * cosO - cosW * sinO * cosI) * orbitalY
    const y = (cosW * sinO + sinW * cosO * cosI) * orbitalX +
      (-sinW * sinO + cosW * cosO * cosI) * orbitalY
    const z = sinW * sinI * orbitalX + cosW * sinI * orbitalY
    positions[index * 2] = x
    positions[index * 2 + 1] = y
    positions3D[index * 3] = x
    positions3D[index * 3 + 1] = y
    positions3D[index * 3 + 2] = z
    if (index > 0 && index % 50_000 === 0) onProgress?.(index / count)
  }
  return { positions, positions3D }
}

export function propagateCatalogElements(elements: Float64Array, julianDay: number, onProgress?: (progress: number) => void) {
  return propagateCatalogElementPositions(elements, julianDay, onProgress).positions
}
