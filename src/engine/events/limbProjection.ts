type Vector = [number, number, number]
type Limb = { centerJ2000Km: Vector; generatorsJ2000Km: Vector[] }
const dot = (a: Vector, b: Vector) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
const cross = (a: Vector, b: Vector): Vector => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]

/** Perspective display of the supplied limb, centered on the body direction.
 * Each point is (ray.east / ray.forward, ray.north / ray.forward).
 * These dimensionless tangent-plane coordinates are not sky angles or new
 * apparent-place corrections. Sampling is for drawing, not contact searches. */
export function projectLimbForDisplay(limb: Limb, observerJ2000Km: Vector, segments = 256) {
  const vectors = [observerJ2000Km, limb.centerJ2000Km, ...limb.generatorsJ2000Km]
  if (limb.generatorsJ2000Km.length !== 2 || vectors.some(vector => vector.length !== 3 || !vector.every(Number.isFinite)) ||
      !Number.isSafeInteger(segments) || segments < 16 || segments > 4096) throw new RangeError('Invalid limb display geometry or segment count')
  const distance = Math.hypot(...observerJ2000Km)
  if (!Number.isFinite(distance) || distance === 0) throw new RangeError('A finite nonzero body-relative observer is required')
  const forward = observerJ2000Km.map(value => -value/distance) as Vector
  let east: Vector = [-forward[1], forward[0], 0]
  let eastLength = Math.hypot(...east)
  // At an equatorial-coordinate pole, east is undefined. Preserve an explicit
  // reproducible basis rather than labeling an arbitrary direction as RA east.
  const poleFallback = eastLength < 1e-12
  if (poleFallback) { east = cross([1, 0, 0], forward); eastLength = Math.hypot(...east) }
  east = east.map(value => value/eastLength) as Vector
  const north = cross(forward, east)
  const [u, v] = limb.generatorsJ2000Km
  const centerRay = limb.centerJ2000Km.map((value, axis) => value-observerJ2000Km[axis]) as Vector
  const minimumDepth = dot(centerRay, forward)-Math.hypot(dot(u, forward), dot(v, forward))
  if (!Number.isFinite(minimumDepth) || minimumDepth <= 0) throw new RangeError('Limb crosses the tangent-plane projection horizon')
  const points: [number, number][] = []
  let extent = 0
  for (let i = 0; i < segments; i++) {
    const theta = 2*Math.PI*i/segments, cosine = Math.cos(theta), sine = Math.sin(theta)
    const ray = limb.centerJ2000Km.map((value, axis) => value + u[axis]*cosine + v[axis]*sine - observerJ2000Km[axis]) as Vector
    const depth = dot(ray, forward)
    if (!Number.isFinite(depth) || depth <= 0) throw new RangeError('Limb crosses the tangent-plane projection horizon')
    const point: [number, number] = [dot(ray, east)/depth, dot(ray, north)/depth]
    if (!point.every(Number.isFinite)) throw new RangeError('Limb projection exceeds finite numerical range')
    points.push(point)
    extent = Math.max(extent, Math.abs(point[0]), Math.abs(point[1]))
  }
  if (!(extent > 0) || !Number.isFinite(extent*1.1)) throw new RangeError('Degenerate limb display extent')
  return {
    model: 'body-centered-perspective-tangent-plane' as const,
    units: 'dimensionless' as const,
    basisJ2000: { forward, horizontal: east, vertical: north },
    poleFallback, segments, points, halfExtent: extent*1.1,
    limitations: 'Sampled visualization only; no certified contour interpolation error, angular-area estimate, contact search, illumination or event probability. All source-limb corrections and limitations remain unchanged.',
  }
}

/** Project a coordinate ray in exactly the displayed limb basis. A marker
 * outside the plot is never clamped onto the limb or used for classification. */
export function projectDirectionForLimbDisplay(view: ReturnType<typeof projectLimbForDisplay>, directionJ2000: Vector) {
  const length = Math.hypot(...directionJ2000)
  const { forward, horizontal, vertical } = view.basisJ2000
  const basis = [forward, horizontal, vertical]
  if (directionJ2000.length !== 3 || !directionJ2000.every(Number.isFinite) || !(length > 0) || !Number.isFinite(length) ||
      !(view.halfExtent > 0) || !Number.isFinite(view.halfExtent) ||
      basis.some(axis => axis.length !== 3 || !axis.every(Number.isFinite) || Math.abs(Math.hypot(...axis)-1) > 1e-10) ||
      Math.abs(dot(forward, horizontal)) > 1e-10 || Math.abs(dot(forward, vertical)) > 1e-10 ||
      Math.abs(dot(horizontal, vertical)) > 1e-10 || dot(cross(forward, horizontal), vertical) < 1-1e-10) {
    throw new RangeError('Invalid sightline or limb projection basis')
  }
  const directionUnitJ2000 = directionJ2000.map(value => value/length) as Vector
  const forwardComponent = dot(directionUnitJ2000, forward)
  const horizonScreeningMargin = 128*Number.EPSILON
  let status: 'inside-plot' | 'outside-plot' | 'behind-view' | 'near-horizon'
  let point: [number, number] | null = null
  if (Math.abs(forwardComponent) <= horizonScreeningMargin) status = 'near-horizon'
  else if (forwardComponent < 0) status = 'behind-view'
  else {
    point = [dot(directionUnitJ2000, horizontal)/forwardComponent, dot(directionUnitJ2000, vertical)/forwardComponent]
    if (!point.every(Number.isFinite)) throw new RangeError('Sightline projection exceeds finite numerical range')
    status = point.every(value => Math.abs(value) <= view.halfExtent) ? 'inside-plot' : 'outside-plot'
  }
  return { model: 'coordinate-ray-in-limb-display-basis' as const, status, point, directionUnitJ2000,
    forwardComponent, horizonScreeningMargin,
    limitations: 'Display location only, not an intersection, angular separation or probability. Outside rays are not clamped. The horizon screening margin is numerical policy, not a physical error bound.' }
}
