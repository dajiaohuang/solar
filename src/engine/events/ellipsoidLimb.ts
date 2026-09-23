type Vector = [number, number, number]
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0)
const cross = (a: number[], b: number[]): Vector => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]

/** Finite-distance geometric limb. The two generators need not be principal
 * axes: center + u*cos(theta) + v*sin(theta) traces the exact model ellipse.
 * Observer is body-center-relative, expressed in J2000, in km. */
export function ellipsoidLimb(radiiKm: Vector, j2000ToBodyFixed: number[], observerJ2000Km: Vector) {
  const matrix = j2000ToBodyFixed
  if (radiiKm.length !== 3 || observerJ2000Km.length !== 3 || matrix.length !== 9 ||
      [...radiiKm, ...observerJ2000Km, ...matrix].some(value => !Number.isFinite(value)) || radiiKm.some(value => value <= 0) ||
      Math.min(...radiiKm)/Math.max(...radiiKm) < 1e-12) throw new RangeError('Finite positive nondegenerate ellipsoid axes, observer and rotation are required')
  const rows = [matrix.slice(0, 3), matrix.slice(3, 6), matrix.slice(6, 9)]
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (Math.abs(dot(rows[i], rows[j]) - Number(i === j)) > 1e-10) throw new RangeError('Expected an orthonormal J2000-to-body-fixed rotation')
  }
  if (dot(rows[0], cross(rows[1], rows[2])) < 1-1e-10) throw new RangeError('Expected a right-handed rotation')
  const observerBodyFixedKm = rows.map(row => dot(row, observerJ2000Km)) as Vector
  const scaledObserver = observerBodyFixedKm.map((value, i) => value/radiiKm[i])
  const distance = Math.hypot(...scaledObserver)
  // Explicit conditioning policy, not physical accuracy/coverage evidence.
  if (!Number.isFinite(distance) || distance <= 1+1e-10 || distance > 1e12) throw new RangeError('Observer must be outside the ellipsoid with scaled distance in (1 + 1e-10, 1e12]')
  const normal = scaledObserver.map(value => value/distance)
  const reference: Vector = [0, 0, 0]
  reference[normal.reduce((best, value, i) => Math.abs(value) < Math.abs(normal[best]) ? i : best, 0)] = 1
  const first = cross(normal, reference), norm = Math.hypot(...first)
  const u = first.map(value => value/norm), v = cross(normal, u)
  const inverseDistance = 1/distance
  const radius = Math.sqrt((1-inverseDistance)*(1+inverseDistance))
  const centerBodyFixedKm = normal.map((value, i) => value * inverseDistance * radiiKm[i]) as Vector
  const generatorsBodyFixedKm = [u, v].map(axis => axis.map((value, i) => value*radius*radiiKm[i]) as Vector)
  const toJ2000 = (vector: Vector) => [0, 1, 2].map(column => rows.reduce((sum, row, i) => sum + row[column]*vector[i], 0)) as Vector
  const centerJ2000Km = toJ2000(centerBodyFixedKm), generatorsJ2000Km = generatorsBodyFixedKm.map(toJ2000)
  if ([...centerJ2000Km, ...generatorsJ2000Km.flat()].some(value => !Number.isFinite(value))) throw new RangeError('Limb exceeds finite numerical range')
  return { model: 'finite-distance-geometric-triaxial-limb' as const, observerBodyFixedKm, centerBodyFixedKm, generatorsBodyFixedKm,
    centerJ2000Km, generatorsJ2000Km, origin: 'body-center' as const, units: 'km' as const,
    parameterization: 'center + generators[0]*cos(theta) + generators[1]*sin(theta); generators are not necessarily principal axes',
    physicalLimbUncertaintyKm: null,
    limitations: ['Geometric limb at the supplied orientation epoch; no light-time, aberration, deflection, terrain, atmosphere or ring correction.',
      'This ellipse does not compute overlapping-body contacts, illumination, event probabilities or certified physical uncertainty.',
      'Conditioning policy: minimum/maximum axis ratio at least 1e-12; scaled observer distance in (1 + 1e-10, 1e12].'] }
}
