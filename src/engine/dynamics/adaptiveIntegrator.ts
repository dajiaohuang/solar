/** Dormand–Prince embedded 5(4), with a maximum component error norm.
 * Independent variable is elapsed time from the caller's reference epoch;
 * do not pass an absolute Julian date as the integration interval.
 * Numerical tolerances are not physical orbit uncertainty. No dense output,
 * event detection, stiffness handling or long-term symplectic claim is made.
 * Method: Dormand & Prince, J. Comput. Appl. Math. 6 (1980), 19–26.
 */
export type Derivative = (elapsed: number, state: Float64Array, output: Float64Array) => void
export type IntegrationOptions = {
  initial: ArrayLike<number>
  duration: number
  derivative: Derivative
  absoluteTolerance: ArrayLike<number>
  relativeTolerance: number
  initialStep: number
  maxStep: number
  maxAttempts: number
  signal?: AbortSignal
  /** Observes accepted endpoints only; receives an owned copy. */
  onAcceptedStep?: (elapsed: number, state: Float64Array) => void
  /** Worker/event-loop cooperation; injectable for deterministic cancellation. */
  yieldControl?: () => Promise<void>
}

const C = [0, 1/5, 3/10, 4/5, 8/9, 1, 1]
const A = [[], [1/5], [3/40, 9/40], [44/45, -56/15, 32/9],
  [19372/6561, -25360/2187, 64448/6561, -212/729],
  [9017/3168, -355/33, 46732/5247, 49/176, -5103/18656],
  [35/384, 0, 500/1113, 125/192, -2187/6784, 11/84]]
const ERROR = [35/384 - 5179/57600, 0, 500/1113 - 7571/16695,
  125/192 - 393/640, -2187/6784 + 92097/339200, 11/84 - 187/2100, -1/40]

export async function integrateAdaptive(options: IntegrationOptions) {
  const { duration, relativeTolerance, maxStep, initialStep, maxAttempts, signal, derivative, onAcceptedStep } = options
  const n = options.initial.length
  if (!Number.isSafeInteger(n) || n < 1 || n > 512 || !Number.isFinite(duration) ||
      !Number.isFinite(relativeTolerance) || relativeTolerance < 1e-14 || relativeTolerance > 1 ||
      !Number.isFinite(maxStep) || maxStep <= 0 || !Number.isFinite(initialStep) || initialStep <= 0 ||
      !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 200_000 ||
      options.absoluteTolerance.length !== n) throw new RangeError('Invalid bounded integration settings')
  const state = Float64Array.from(options.initial), absolute = Float64Array.from(options.absoluteTolerance)
  if (!state.every(Number.isFinite) || !absolute.every(value => Number.isFinite(value) && value > 0)) throw new RangeError('Initial state and component tolerances must be finite, with positive tolerances')
  const cancelled = () => { if (signal?.aborted) throw new DOMException('Integration cancelled', 'AbortError') }
  cancelled()
  const stages = Array.from({ length: 7 }, () => new Float64Array(n))
  const trial = new Float64Array(n)
  const compensation = new Float64Array(n), nextCompensation = new Float64Array(n)
  let elapsed = 0, accepted = 0, rejected = 0, evaluations = 0, attempts = 0
  let timeCompensation = 0
  let smallestAcceptedStep = Infinity, largestAcceptedStep = 0, maxAcceptedErrorRatio = 0
  const evaluate = (time: number, input: Float64Array, output: Float64Array) => {
    cancelled()
    if (!Number.isFinite(time) || !input.every(Number.isFinite)) throw new RangeError('Integration stage became nonfinite')
    // A partially written derivative cannot reuse old buffer contents.
    output.fill(NaN)
    derivative(time, input, output)
    evaluations++
    if (!output.every(Number.isFinite)) throw new RangeError('Derivative did not write a finite value for every component')
  }
  const direction = Math.sign(duration)
  let stepSize = Math.min(initialStep, maxStep, Math.abs(duration))
  if (duration !== 0) evaluate(0, state, stages[0])
  const yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)))
  while (direction * (duration - elapsed) > 0) {
    cancelled()
    if (attempts >= maxAttempts) throw new RangeError('Integration exhausted its attempt budget before reaching the requested epoch')
    if (attempts > 0 && attempts % 32 === 0) { await yieldControl(); cancelled() }
    attempts++
    const remaining = Math.abs((duration - elapsed) + timeCompensation), magnitude = Math.min(stepSize, maxStep, remaining)
    const step = direction * magnitude, timeIncrement = step - timeCompensation
    const nextTime = magnitude === remaining ? duration : elapsed + timeIncrement
    const nextTimeCompensation = magnitude === remaining ? 0 : (nextTime - elapsed) - timeIncrement
    if (elapsed + step === elapsed || !(magnitude > 0)) throw new RangeError('Integration step is below elapsed-time resolution')
    for (let stage = 1; stage < 7; stage++) {
      for (let i = 0; i < n; i++) {
        let slope = 0
        for (let j = 0; j < stage; j++) slope += A[stage][j] * stages[j][i]
        const increment = step * slope - compensation[i]
        trial[i] = state[i] + increment
        if (stage === 6) nextCompensation[i] = (trial[i] - state[i]) - increment
      }
      evaluate(stage >= 5 ? nextTime : elapsed + (C[stage] * step - timeCompensation), trial, stages[stage])
    }
    let errorRatio = 0
    for (let i = 0; i < n; i++) {
      let difference = 0
      for (let j = 0; j < 7; j++) difference += ERROR[j] * stages[j][i]
      const scale = absolute[i] + relativeTolerance * Math.max(Math.abs(state[i]), Math.abs(trial[i]))
      const ratio = Math.abs(step * difference) / scale
      if (!Number.isFinite(scale) || !Number.isFinite(ratio)) throw new RangeError('Integration error estimate became nonfinite')
      errorRatio = Math.max(errorRatio, ratio)
    }
    const factor = errorRatio === 0 ? 5 : Math.min(5, Math.max(.1, .9 * errorRatio ** (-1/5)))
    if (errorRatio <= 1) {
      state.set(trial); compensation.set(nextCompensation); elapsed = nextTime; timeCompensation = nextTimeCompensation; accepted++
      stages[0].set(stages[6]) // FSAL: derivative at the accepted endpoint.
      smallestAcceptedStep = Math.min(smallestAcceptedStep, magnitude)
      largestAcceptedStep = Math.max(largestAcceptedStep, magnitude)
      maxAcceptedErrorRatio = Math.max(maxAcceptedErrorRatio, errorRatio)
      onAcceptedStep?.(elapsed, state.slice())
    } else rejected++
    stepSize = magnitude * (errorRatio > 1 ? Math.min(1, factor) : factor)
  }
  cancelled()
  return { algorithm: 'dormand-prince-54-component-max-v1' as const,
    elapsed, state, accepted, rejected, evaluations, attempts,
    smallestAcceptedStep: accepted ? smallestAcceptedStep : null, largestAcceptedStep,
    maxAcceptedErrorRatio, relativeTolerance, absoluteTolerance: absolute,
    maxStep, initialStep, maxAttempts }
}
