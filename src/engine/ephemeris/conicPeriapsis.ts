export type PeriapsisConic = {
  periapsisKm: number; eccentricity: number; gmKm3PerSecond2: number
  inclinationRadians: number; ascendingNodeRadians: number; argumentOfPeriapsisRadians: number
}

function stumpff(z: number) {
  if (Math.abs(z) < 0.1) {
    let c = 0.5, s = 1/6, ct = c, st = s
    for (let k = 1; k <= 12; k++) {
      ct *= -z/((2*k+1)*(2*k+2)); st *= -z/((2*k+2)*(2*k+3)); c += ct; s += st
    }
    return { c, s, t:1-z*s }
  }
  const u = Math.sqrt(Math.abs(z))
  return z > 0 ? { c:2*(Math.sin(u/2)/u)**2, s:(u-Math.sin(u))/u**3, t:Math.sin(u)/u }
    : { c:2*(Math.sinh(u/2)/u)**2, s:(Math.sinh(u)-u)/u**3, t:Math.sinh(u)/u }
}

/** Unperturbed Newtonian conic from periapsis, km and TDB elapsed seconds.
 * Universal variables avoid dividing by (1-e) at the parabolic boundary.
 * This is not an SPK trajectory or a non-gravitational comet force model. */
export function propagatePeriapsisConic(conic: PeriapsisConic, elapsedTdbSeconds: number) {
  const { periapsisKm:q, eccentricity:e, gmKm3PerSecond2:mu, inclinationRadians:i, ascendingNodeRadians:o, argumentOfPeriapsisRadians:w } = conic
  if (![q,e,mu,i,o,w,elapsedTdbSeconds].every(Number.isFinite) || q <= 0 || e < 0 || mu <= 0 || i < 0 || i > Math.PI) throw new RangeError('Invalid periapsis conic')
  const speed = Math.sqrt(mu/q), timeScale = q/speed, beta = 1-e
  let tau = elapsedTdbSeconds/timeScale
  if (!Number.isFinite(tau) || !Number.isFinite(speed) || !(speed > 0) || !Number.isFinite(timeScale) || !(timeScale > 0)) throw new RangeError('Conic exceeds numerical range')
  if (beta > 0) {
    const period = 2*Math.PI/beta**1.5
    if (Number.isFinite(period)) {
      tau %= period
      if (tau > period/2) tau -= period
      else if (tau < -period/2) tau += period
    }
  }
  const target = Math.abs(tau), sign = tau < 0 ? -1 : 1
  const evaluate = (x: number) => {
    const {c,s,t} = stumpff(beta*x*x)
    return { value:x+e*x*x*x*s, derivative:1+e*x*x*c, c, t }
  }
  let low = 0, high = Math.min(1,target), converged = target === 0
  for (let step = 0; step < 128 && evaluate(high).value < target; step++) high *= 2
  if (evaluate(high).value < target) throw new RangeError('Conic root could not be bracketed')
  let x = high
  for (let step = 0; step < 128 && !converged; step++) {
    const result = evaluate(x), residual = result.value-target, correction = residual/result.derivative
    if (Number.isFinite(correction) && Math.abs(correction) <= 8*Number.EPSILON*Math.abs(x)) { converged = true; break }
    if (residual > 0 || !Number.isFinite(result.value)) high = x
    else low = x
    const next = x-correction
    const candidate = Number.isFinite(next) && next > low && next < high ? next : (low+high)/2
    if (candidate === x) { converged = true; break }
    x = candidate
  }
  if (!converged) throw new RangeError('Conic root did not converge')
  x *= sign
  const {c,t} = evaluate(x), radius = 1+e*x*x*c, transverse = Math.sqrt(1+e)
  const px = q*(1-x*x*c), py = q*transverse*x*t
  // Combine the numerator before dividing: 1-x²C/r cancels near the
  // parabolic asymptote, erasing a representable transverse velocity.
  const vx = -speed*x*t/radius, vy = speed*transverse*((1-beta*x*x*c)/radius)
  const co = Math.cos(o), so = Math.sin(o), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i)
  const rotate = (a: number,b: number) => ({ x:(co*cw-so*sw*ci)*a+(-co*sw-so*cw*ci)*b,
    y:(so*cw+co*sw*ci)*a+(-so*sw+co*cw*ci)*b, z:sw*si*a+cw*si*b })
  const positionKm = rotate(px,py), velocityKmPerSecond = rotate(vx,vy)
  if (![...Object.values(positionKm),...Object.values(velocityKmPerSecond)].every(Number.isFinite)) throw new RangeError('Conic state exceeds numerical range')
  return { positionKm, velocityKmPerSecond }
}
