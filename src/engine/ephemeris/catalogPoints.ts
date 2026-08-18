const RAD = Math.PI / 180
export const CATALOG_ELEMENT_STRIDE = 8

function normalizeRadians(value: number) {
  const wrapped = value % (Math.PI * 2)
  return wrapped < 0 ? wrapped + Math.PI * 2 : wrapped
}

function solveEccentricAnomaly(meanAnomaly: number, eccentricity: number) {
  let eccentricAnomaly = eccentricity < 0.8 ? meanAnomaly : Math.PI
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const delta = (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly) /
      (1 - eccentricity * Math.cos(eccentricAnomaly))
    eccentricAnomaly -= delta
    if (Math.abs(delta) < 1e-12) break
  }
  return eccentricAnomaly
}

export function propagateCatalogElements(
  elements: Float64Array,
  julianDay: number,
  onProgress?: (progress: number) => void,
) {
  if (elements.length % CATALOG_ELEMENT_STRIDE !== 0) throw new Error('Catalog element buffer has an invalid stride')
  const count = elements.length / CATALOG_ELEMENT_STRIDE
  const positions = new Float32Array(count * 2)
  for (let index = 0; index < count; index += 1) {
    const offset = index * CATALOG_ELEMENT_STRIDE
    const epochJd = elements[offset]
    const semiMajorAxisAU = elements[offset + 1]
    const eccentricity = elements[offset + 2]
    if (!(semiMajorAxisAU > 0) || eccentricity < 0 || eccentricity >= 1) {
      throw new Error(`Catalog record ${index} is not a supported elliptic orbit`)
    }
    const inclination = elements[offset + 3] * RAD
    const ascendingNode = elements[offset + 4] * RAD
    const argPeriapsis = elements[offset + 5] * RAD
    const meanAnomaly = normalizeRadians((elements[offset + 6] + elements[offset + 7] * (julianDay - epochJd)) * RAD)
    const eccentricAnomaly = solveEccentricAnomaly(meanAnomaly, eccentricity)
    const orbitalX = semiMajorAxisAU * (Math.cos(eccentricAnomaly) - eccentricity)
    const orbitalY = semiMajorAxisAU * Math.sqrt(1 - eccentricity ** 2) * Math.sin(eccentricAnomaly)
    const cosW = Math.cos(argPeriapsis), sinW = Math.sin(argPeriapsis)
    const cosO = Math.cos(ascendingNode), sinO = Math.sin(ascendingNode), cosI = Math.cos(inclination)
    positions[index * 2] = (cosW * cosO - sinW * sinO * cosI) * orbitalX +
      (-sinW * cosO - cosW * sinO * cosI) * orbitalY
    positions[index * 2 + 1] = (cosW * sinO + sinW * cosO * cosI) * orbitalX +
      (-sinW * sinO + cosW * cosO * cosI) * orbitalY
    if (index > 0 && index % 50_000 === 0) onProgress?.(index / count)
  }
  return positions
}
