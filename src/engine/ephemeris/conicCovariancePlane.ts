/** Perifocal conic and derivatives with respect to e, q and periapsis time.
 * Units are the caller's consistent length/day/GM units. No orbit-fit force
 * model is implied. Universal variables stay regular at eccentricity one. */
function functions(z: number) {
  if (Math.abs(z) < 0.1) {
    let c = .5, s = 1/6, dc = 0, ds = 0
    let cp = .5, sp = 1/6, power = 1, previousPower = 1
    for (let k = 1; k <= 16; k++) {
      cp /= -(2*k+1)*(2*k+2); sp /= -(2*k+2)*(2*k+3)
      power *= z
      c += cp*power; s += sp*power
      dc += k*cp*previousPower; ds += k*sp*previousPower
      previousPower = power
    }
    return { c, s, t: 1-z*s, dc, ds, dt: -s-z*ds }
  }
  const u = Math.sqrt(Math.abs(z))
  const c = z > 0 ? 2*(Math.sin(u/2)/u)**2 : 2*(Math.sinh(u/2)/u)**2
  const s = z > 0 ? (u-Math.sin(u))/u**3 : (Math.sinh(u)-u)/u**3
  const t = z > 0 ? Math.sin(u)/u : Math.sinh(u)/u
  return { c, s, t, dc: (t-2*c)/(2*z), ds: (c-3*s)/(2*z), dt: (s-c)/2 }
}

export function conicCovariancePlane(e: number, q: number, elapsedDays: number, mu: number) {
  if (![e,q,elapsedDays,mu].every(Number.isFinite) || e < 0 || q <= 0 || mu <= 0) throw new RangeError('Invalid conic covariance scale')
  const speed = Math.sqrt(mu/q), timeScale = q/speed, tau = elapsedDays/timeScale, beta = 1-e
  // A numerical policy, not source validity. Do not reduce elliptic revolutions:
  // the unwrapped time sensitivity is required by the covariance derivative.
  if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(timeScale) || timeScale <= 0 ||
      !Number.isFinite(tau) || Math.abs(tau) > 1e6) throw new RangeError('Conic covariance dimensionless elapsed time exceeds 1e6')
  const evaluate = (u: number) => {
    const f = functions(beta*u*u)
    return { ...f, value: u+e*u*u*u*f.s, radius: 1+e*u*u*f.c }
  }
  const target = Math.abs(tau)
  let low = 0, high = Math.min(1,target), converged = target === 0
  for (let step = 0; step < 128 && evaluate(high).value < target; step++) high *= 2
  if (evaluate(high).value < target) throw new RangeError('Conic covariance root could not be bracketed')
  let u = high
  for (let step = 0; step < 128 && !converged; step++) {
    const f = evaluate(u), residual = f.value-target, correction = residual/f.radius
    if (Number.isFinite(correction) && Math.abs(correction) <= 8*Number.EPSILON*Math.abs(u)) { converged = true; break }
    if (residual > 0 || !Number.isFinite(f.value)) high = u
    else low = u
    const next = u-correction
    const candidate = Number.isFinite(next) && next > low && next < high ? next : (low+high)/2
    if (candidate === u) { converged = true; break }
    u = candidate
  }
  if (!converged) throw new RangeError('Conic covariance root did not converge')
  if (tau < 0) u = -u
  const f = evaluate(u), transverse = Math.sqrt(1+e), w = u*u*f.c, h = u*f.t
  const numerator = 1-beta*w
  const x = q*(1-w), y = q*transverse*h
  const vx = -speed*h/f.radius, vy = speed*transverse*numerator/f.radius
  const derivatives = [0,1,2].map(axis => {
    const de = Number(axis === 0), dq = Number(axis === 1), dbeta = -de
    const dTau = axis === 1 ? -1.5*tau/q : axis === 2 ? -1/timeScale : 0
    // F(u,e)=u+e*u^3*S((1-e)u^2)-tau=0; dF/du=radius/q.
    const du = (dTau-de*(u**3*f.s-e*u**5*f.ds))/f.radius
    const dz = dbeta*u*u+2*beta*u*du
    const dw = 2*u*f.c*du+u*u*f.dc*dz
    const dh = f.t*du+u*f.dt*dz
    const dr = de*w+e*dw, dTransverse = de/(2*transverse), dSpeed = -.5*speed*dq/q
    const dNumerator = -dbeta*w-beta*dw
    return [dq*(1-w)-q*dw,
      dq*transverse*h+q*dTransverse*h+q*transverse*dh,
      -(dSpeed*h+speed*dh)/f.radius+speed*h*dr/f.radius**2,
      (dSpeed*transverse*numerator+speed*dTransverse*numerator+speed*transverse*dNumerator)/f.radius-
        speed*transverse*numerator*dr/f.radius**2]
  })
  if (![x,y,vx,vy,...derivatives.flat()].every(Number.isFinite) || !(f.radius > 0)) throw new RangeError('Conic covariance lost numerical validity')
  return { x, y, vx, vy, derivatives }
}
