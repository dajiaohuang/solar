export type TrajectorySearchProgress = {
  attemptedEvaluations: number; completedEvaluations: number; retainedEventCount: number; lastAttemptSeconds: number | null
}
export class TrajectoryLocalizationError extends RangeError {
  readonly bracketSeconds: readonly [number,number]
  readonly bracketValues: readonly [number,number]
  readonly searchProgress: Readonly<TrajectorySearchProgress>
  constructor(bracket: [number,number], values: [number,number], progress: TrajectorySearchProgress) {
    super('Trajectory event tolerance is below the remaining bracket numerical resolution')
    this.name = 'TrajectoryLocalizationError'
    this.bracketSeconds = Object.freeze([...bracket] as [number,number])
    this.bracketValues = Object.freeze([...values] as [number,number])
    this.searchProgress = Object.freeze({...progress})
  }
}

function trajectoryScanTime(startSeconds: number, endSeconds: number, duration: number, intervals: number, index: number) {
  return index === intervals ? endSeconds : startSeconds + (duration / intervals) * index
}

export function trajectoryScanIntervals(
  duration: number,
  maxStepSeconds: number,
  startSeconds = 0,
  endSeconds = startSeconds + duration,
  maxEvaluations = 200_000,
) {
  if (![duration, maxStepSeconds, startSeconds, endSeconds].every(Number.isFinite) || duration < 0 ||
      endSeconds < startSeconds || maxStepSeconds <= 0 || !Number.isSafeInteger(maxEvaluations) ||
      maxEvaluations < 1 || maxEvaluations > 200_000) {
    throw new RangeError('Invalid trajectory scan interval')
  }
  // Positive division can underflow; a nonempty window still needs both ends.
  let intervals = duration === 0 ? 0 : Math.max(1, Math.ceil(duration / maxStepSeconds))
  // Avoid a long geometry walk when the caller's evaluation budget already
  // makes this scan impossible; its caller returns the typed budget error.
  if (!Number.isSafeInteger(intervals) || intervals + 1 > maxEvaluations || intervals >= 200_000) return intervals
  while (duration > 0) {
    let previous = startSeconds
    let fits = true
    for (let index = 1; index <= intervals; index++) {
      const next = trajectoryScanTime(startSeconds, endSeconds, duration, intervals, index)
      if (!(next > previous)) throw new RangeError('Trajectory scan is below elapsed-time resolution')
      if (next - previous > maxStepSeconds) {
        fits = false
        break
      }
      previous = next
    }
    if (fits) return intervals
    intervals++
    if (intervals + 1 > maxEvaluations || intervals >= 200_000) return intervals
  }
  return intervals
}
export class TrajectoryEventBudgetError extends RangeError {
  readonly resource: 'evaluations' | 'events' | 'forces'
  readonly searchProgress?: Readonly<TrajectorySearchProgress>
  constructor(resource: 'evaluations' | 'events' | 'forces', message: string, progress?: TrajectorySearchProgress) {
    super(message)
    this.resource = resource
    this.name = 'TrajectoryEventBudgetError'
    if (progress) this.searchProgress = Object.freeze({ ...progress })
  }
}

export type TrajectoryEvent = {
  kind: 'sampled-zero' | 'sign-change'
  direction: 'increasing' | 'decreasing' | 'unclassified'
  elapsedTdbSeconds: number
  scanBracketSeconds: [number, number]
  localizationBracketSeconds: [number, number]
  localizationValues: [number, number]
}

/** Scalar zero search for an asynchronous, frozen trajectory evaluator.
 * Samples are evaluated from the same initial/source contract by the caller.
 * This locates sampled sign changes, not all events or physical uncertainty.
 */
export async function findTrajectoryEvents(options: {
  evaluate: (elapsedTdbSeconds: number) => number | Promise<number>
  referenceEpochTdb: number
  startSeconds: number
  endSeconds: number
  maxStepSeconds: number
  toleranceSeconds: number
  maxEvaluations: number
  maxEvents: number
  signal?: AbortSignal
}) {
  const { evaluate, referenceEpochTdb, startSeconds, endSeconds, maxStepSeconds,
    toleranceSeconds, maxEvaluations, maxEvents, signal } = options
  const duration = endSeconds-startSeconds
  if (![referenceEpochTdb, startSeconds, endSeconds, duration, maxStepSeconds, toleranceSeconds].every(Number.isFinite) ||
      duration < 0 || maxStepSeconds <= 0 || toleranceSeconds <= 0 || toleranceSeconds > maxStepSeconds ||
      !Number.isSafeInteger(maxEvaluations) || maxEvaluations < 1 || maxEvaluations > 200000 ||
      !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 4096) {
    throw new RangeError('Invalid bounded trajectory event search')
  }
  const intervals = trajectoryScanIntervals(duration, maxStepSeconds, startSeconds, endSeconds, maxEvaluations)
  if (!Number.isSafeInteger(intervals) || intervals+1 > maxEvaluations) throw new TrajectoryEventBudgetError('evaluations', 'Trajectory scan exceeds its evaluation budget')
  let evaluations = 0, maximumScanIntervalSeconds = 0, sliceStarted = performance.now()
  let completedEvaluations = 0, lastAttemptSeconds: number | null = null
  const events: TrajectoryEvent[] = []
  const budgetError = (resource: 'evaluations' | 'events' | 'forces', message: string) =>
    new TrajectoryEventBudgetError(resource,message,{attemptedEvaluations:evaluations,completedEvaluations,
      retainedEventCount:events.length,lastAttemptSeconds})
  const sample = async (time: number) => {
    signal?.throwIfAborted()
    if (evaluations >= maxEvaluations) throw budgetError('evaluations', 'Trajectory event refinement exceeds its evaluation budget')
    // Also cooperate when evaluate returns synchronously or an already-resolved
    // promise: awaiting it alone does not service worker cancellation messages.
    if (evaluations && (evaluations%64 === 0 || performance.now()-sliceStarted >= 4)) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      signal?.throwIfAborted()
      sliceStarted = performance.now()
    }
    evaluations++
    lastAttemptSeconds = time
    let value: number
    try { value = await evaluate(time) }
    catch (error) {
      signal?.throwIfAborted()
      if (error instanceof TrajectoryEventBudgetError) throw budgetError(error.resource,error.message)
      throw error
    }
    signal?.throwIfAborted()
    if (!Number.isFinite(value)) throw new RangeError('Trajectory event function returned a nonfinite value')
    completedEvaluations++
    return value
  }
  const add = (event: TrajectoryEvent) => {
    if (events.length >= maxEvents) throw budgetError('events', 'Trajectory events exceed the result budget')
    events.push(event)
  }
  const zero = (time: number) => add({ kind: 'sampled-zero', direction: 'unclassified', elapsedTdbSeconds: time,
    scanBracketSeconds: [time,time], localizationBracketSeconds: [time,time], localizationValues: [0,0] })
  let leftTime = startSeconds, left = await sample(startSeconds)
  const startValue = left
  if (left === 0) zero(leftTime)
  for (let interval = 1; interval <= intervals; interval++) {
    const rightTime = trajectoryScanTime(startSeconds, endSeconds, duration, intervals, interval)
    if (!(rightTime > leftTime)) throw new RangeError('Trajectory scan is below elapsed-time resolution')
    const scanInterval = rightTime - leftTime
    if (scanInterval > maxStepSeconds) throw new RangeError('Trajectory scan interval exceeds configured maximum')
    maximumScanIntervalSeconds = Math.max(maximumScanIntervalSeconds, scanInterval)
    const right = await sample(rightTime)
    if (right === 0) zero(rightTime)
    else if (left !== 0 && (left < 0) !== (right < 0)) {
      let lo = leftTime, hi = rightTime, lowValue = left, highValue = right
      while (hi-lo > toleranceSeconds) {
        const middle = lo+(hi-lo)/2
        if (!(middle > lo && middle < hi)) throw new TrajectoryLocalizationError([lo,hi],[lowValue,highValue],
          {attemptedEvaluations:evaluations,completedEvaluations,retainedEventCount:events.length,lastAttemptSeconds})
        const value = await sample(middle)
        if (value === 0) { lo = middle; hi = middle; lowValue = 0; highValue = 0; break }
        if ((value < 0) === (lowValue < 0)) { lo = middle; lowValue = value }
        else { hi = middle; highValue = value }
      }
      add({ kind: 'sign-change', direction: left < 0 ? 'increasing' : 'decreasing',
        elapsedTdbSeconds: lo+(hi-lo)/2, scanBracketSeconds: [leftTime,rightTime],
        localizationBracketSeconds: [lo,hi], localizationValues: [lowValue,highValue] })
    }
    leftTime = rightTime; left = right
  }
  signal?.throwIfAborted()
  return {
    method: 'async-sampled-sign-change-bisection-v1' as const,
    timeScale: 'TDB' as const, referenceEpochTdb, startSeconds, endSeconds,
    events, evaluations, maxEvaluations, maxEvents, scanIntervals: intervals,
    requestedMaxStepSeconds: maxStepSeconds, maximumScanIntervalSeconds, toleranceSeconds,
    startValue, endValue: left, coverage: 'sampled-sign-changes-only' as const,
    possibleMissedEvents: true as const,
    limitations: [
      'Requires a continuous scalar event function and one frozen source/initial-state contract; neither is certified by this search.',
      'Tangencies, zero plateaus and multiple crossings between scan samples are not completely detected. No events found does not prove absence.',
      'Direction describes the signs across the scan bracket, not a certified local derivative or unique crossing.',
      'Localization brackets bound numerical sign-change refinement only, not trajectory integration error or physical event-time uncertainty.',
      'A numerically exact sampled zero has no inferred crossing direction or physical zero-width uncertainty.',
      'Evaluation budgets count event-function calls, not their underlying force evaluations; trajectory providers must enforce a separate shared budget.',
      'Cancellation, evaluation failures and exhausted budgets reject the entire search; no partial-success result is returned.',
    ],
  }
}
