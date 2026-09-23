const C_KM_PER_SECOND = 299792.458
type Position = readonly [number, number, number]

/** Converged Newtonian reception light time in relative TDB seconds. The
 * observer is fixed at reception; the target is evaluated at emission. */
export function receptionLightTime(options: {
  observerPositionKm: Position
  targetPositionKm: (elapsedTdbSeconds: number) => Position
  elapsedTdbSeconds: number
  maxLightTimeSeconds: number
  toleranceSeconds?: number
  maxIterations?: number
}) {
  const { targetPositionKm, elapsedTdbSeconds, maxLightTimeSeconds, toleranceSeconds = 1e-9, maxIterations = 12 } = options
  const observer = [...options.observerPositionKm]
  if (observer.length !== 3 || observer.some(value => !Number.isFinite(value)) || !Number.isFinite(elapsedTdbSeconds) ||
      !Number.isFinite(maxLightTimeSeconds) || maxLightTimeSeconds <= 0 || maxLightTimeSeconds > 86400 ||
      !Number.isFinite(toleranceSeconds) || toleranceSeconds <= 0 || toleranceSeconds > 1 || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 100) throw new RangeError('Invalid bounded reception light-time inputs')
  let lightTimeSeconds = 0
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const emissionElapsedTdbSeconds = elapsedTdbSeconds-lightTimeSeconds
    if (!Number.isFinite(emissionElapsedTdbSeconds) || (lightTimeSeconds > 0 && emissionElapsedTdbSeconds === elapsedTdbSeconds)) throw new RangeError('Emission epoch is below the numerical time resolution')
    const target = targetPositionKm(emissionElapsedTdbSeconds)
    if (target.length !== 3 || target.some(value => !Number.isFinite(value))) throw new RangeError('Nonfinite reception target position')
    const positionKm = target.map((value, i) => value-observer[i]) as [number, number, number]
    const rangeKm = Math.hypot(...positionKm), next = rangeKm/C_KM_PER_SECOND
    if (!Number.isFinite(next) || next > maxLightTimeSeconds) throw new RangeError('Reception light time exceeds the explicit source margin')
    const residualSeconds = Math.abs(next-lightTimeSeconds)
    if (residualSeconds <= toleranceSeconds) return { positionKm, rangeKm, lightTimeSeconds, emissionElapsedTdbSeconds,
      iterations: iteration, residualSeconds, toleranceSeconds, maxLightTimeSeconds,
      model: 'converged-newtonian-reception' as const,
      limitations: ['Center-to-center Newtonian reception light time, not a relativistic light-propagation model.',
        'No stellar aberration, gravitational deflection or differential light time across an extended limb.',
        'Iteration residual is numerical convergence evidence, not physical angular or timing uncertainty.'] }
    lightTimeSeconds = next
  }
  throw new RangeError('Reception light-time iteration did not converge')
}
