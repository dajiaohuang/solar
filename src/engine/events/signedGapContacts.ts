import { OCCULTATION_MAX_EVALUATIONS, occultationScanIntervalCount } from './occultationContacts.ts'

export type SignedGapContact = {
  boundary: 'ellipsoid-limb'
  direction: 'enter' | 'exit' | 'sampled-zero'
  elapsedTdbSeconds: number
  scanBracketSeconds: [number, number]
  bracketSeconds: [number, number]
}

type WindowEdge = {
  elapsedTdbSeconds: number
  bracketSeconds: [number, number]
  kind: 'search-boundary' | 'sampled-intercept' | 'sampled-zero' | 'bracketed-contact'
}

export type SampledInterceptWindow = {
  boundary: 'ellipsoid-limb'
  start: WindowEdge
  end: WindowEdge
  durationSeconds: number
  numericalDurationBoundsSeconds: [number, number]
}

export type SignedGapSample = { value: number; indeterminateMargin: number }
export type NumericallyScreenedCrossing = {
  boundary: 'ellipsoid-limb'
  direction: 'enter' | 'exit'
  scanBracketSeconds: [number, number]
  screeningSampleSeconds: number
  screeningGapScaled: number
  screeningMarginScaled: number
}

/** Search one explicitly signed scalar boundary. A negative value outside its
 * indeterminate margin means the forward ray intersects the shape. The scalar's
 * units remain caller-defined and are never labeled as angular or physical distance. */
export async function findSignedGapContacts(options: {
  evaluateGap: (elapsedTdbSeconds: number) => SignedGapSample
  startSeconds: number
  endSeconds: number
  maxStepSeconds: number
  toleranceSeconds: number
  maxEvaluations?: number
  maxContacts?: number
  signal?: AbortSignal
}) {
  const { evaluateGap, startSeconds, endSeconds, maxStepSeconds, toleranceSeconds, signal,
    maxEvaluations = OCCULTATION_MAX_EVALUATIONS, maxContacts = 512 } = options
  const duration = endSeconds-startSeconds
  if (![startSeconds, endSeconds, duration, maxStepSeconds, toleranceSeconds].every(Number.isFinite) || duration < 0 || maxStepSeconds <= 0 ||
      toleranceSeconds <= 0 || toleranceSeconds > maxStepSeconds || !Number.isSafeInteger(maxEvaluations) ||
      maxEvaluations < 2 || maxEvaluations > OCCULTATION_MAX_EVALUATIONS || !Number.isSafeInteger(maxContacts) || maxContacts < 1 || maxContacts > 4096) {
    throw new RangeError('Invalid bounded ellipsoid-ray contact settings')
  }
  const intervals = occultationScanIntervalCount(duration, maxStepSeconds, startSeconds, endSeconds, maxEvaluations)
  if (!Number.isSafeInteger(intervals) || intervals+1 > maxEvaluations) throw new RangeError('Ellipsoid-ray scan exceeds the evaluation budget')
  let evaluations = 0, maximumScanIntervalSeconds = 0
  const cancelled = () => { if (signal?.aborted) throw new DOMException('Ellipsoid-ray contact search cancelled', 'AbortError') }
  const indeterminateSamples: { elapsedTdbSeconds: number; gapScaled: number; screeningMarginScaled: number }[] = []
  const indeterminateTimes = new Set<number>()
  const sample = async (time: number): Promise<SignedGapSample> => {
    cancelled()
    if (evaluations >= maxEvaluations) throw new RangeError('Ellipsoid-ray refinement exceeds the evaluation budget')
    if (evaluations && evaluations%64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); cancelled() }
    evaluations++
    const value = evaluateGap(time)
    if (!Number.isFinite(value.value) || !Number.isFinite(value.indeterminateMargin) || value.indeterminateMargin < 0) {
      throw new RangeError('Ellipsoid-ray source returned a nonfinite signed gap or invalid screening margin')
    }
    if (Math.abs(value.value) <= value.indeterminateMargin && !indeterminateTimes.has(time)) {
      indeterminateTimes.add(time)
      indeterminateSamples.push({ elapsedTdbSeconds: time, gapScaled: value.value, screeningMarginScaled: value.indeterminateMargin })
    }
    cancelled()
    return value
  }
  const contacts: SignedGapContact[] = []
  const numericallyScreenedCrossings: NumericallyScreenedCrossing[] = []
  const spans: { start: WindowEdge; end: WindowEdge }[] = []
  const edge = (time: number, kind: WindowEdge['kind'], bracket: [number, number] = [time, time]): WindowEdge => {
    const clippedSample = (time === startSeconds || time === endSeconds) && bracket[0] === time && bracket[1] === time
    return { elapsedTdbSeconds: time, bracketSeconds: [...bracket], kind: clippedSample ? 'search-boundary' : kind }
  }
  const overlap = (start: WindowEdge, end: WindowEdge) => {
    if (!(end.elapsedTdbSeconds > start.elapsedTdbSeconds)) return
    const previous = spans.at(-1)
    if (previous?.end.elapsedTdbSeconds === start.elapsedTdbSeconds) previous.end = end
    else spans.push({ start, end })
  }
  const add = (contact: SignedGapContact) => {
    if (contacts.length >= maxContacts) throw new RangeError('Ellipsoid-ray contacts exceed the result budget')
    contacts.push(contact)
  }
  const definite = (value: SignedGapSample) => Math.abs(value.value) > value.indeterminateMargin
  const intersects = (value: SignedGapSample) => value.value < -value.indeterminateMargin
  let leftTime = startSeconds, left = await sample(startSeconds)
  const startGapScaled = left.value
  if (left.value === 0 && left.indeterminateMargin === 0) add({ boundary: 'ellipsoid-limb', direction: 'sampled-zero', elapsedTdbSeconds: leftTime,
    scanBracketSeconds: [leftTime, leftTime], bracketSeconds: [leftTime, leftTime] })
  for (let i = 1; i <= intervals; i++) {
    const rightTime = i === intervals ? endSeconds : startSeconds+(duration/intervals)*i
    if (!(rightTime > leftTime)) throw new RangeError('Ellipsoid-ray scan interval is below the epoch numerical resolution')
    const scanInterval = rightTime-leftTime
    if (scanInterval > maxStepSeconds) throw new RangeError('Ellipsoid-ray scan interval exceeds its configured maximum')
    maximumScanIntervalSeconds = Math.max(maximumScanIntervalSeconds, scanInterval)
    const right = await sample(rightTime)
    let crossing: WindowEdge | undefined
    if (right.value === 0 && right.indeterminateMargin === 0) add({ boundary: 'ellipsoid-limb', direction: 'sampled-zero', elapsedTdbSeconds: rightTime,
      scanBracketSeconds: [rightTime, rightTime], bracketSeconds: [rightTime, rightTime] })
    else if (definite(left) && definite(right) && (left.value < 0) !== (right.value < 0)) {
      let lo = leftTime, hi = rightTime, lowValue = left.value, screened: SignedGapSample | undefined, screenedAt = 0
      while (hi-lo > toleranceSeconds) {
        const middle = lo+(hi-lo)/2
        if (!(middle > lo && middle < hi)) throw new RangeError('Ellipsoid-ray tolerance is below the epoch numerical resolution')
        const value = await sample(middle)
        if (!definite(value)) { screened = value; screenedAt = middle; break }
        if (value.value === 0) { lo = middle; hi = middle; break }
        if ((value.value < 0) === (lowValue < 0)) { lo = middle; lowValue = value.value } else hi = middle
      }
      if (screened) {
        numericallyScreenedCrossings.push({ boundary: 'ellipsoid-limb', direction: left.value > 0 ? 'enter' : 'exit',
          scanBracketSeconds: [leftTime, rightTime], screeningSampleSeconds: screenedAt,
          screeningGapScaled: screened.value, screeningMarginScaled: screened.indeterminateMargin })
      } else {
        const time = lo+(hi-lo)/2
        add({ boundary: 'ellipsoid-limb', direction: left.value > 0 ? 'enter' : 'exit', elapsedTdbSeconds: time,
          scanBracketSeconds: [leftTime, rightTime], bracketSeconds: [lo, hi] })
        crossing = edge(time, 'bracketed-contact', [lo, hi])
      }
    }
    const leftEdge = edge(leftTime, left.value === 0 ? 'sampled-zero' : 'sampled-intercept')
    const rightEdge = edge(rightTime, right.value === 0 ? 'sampled-zero' : 'sampled-intercept')
    // Strictly negative signs establish interception; an exact, unscreened
    // sampled zero may still bound an adjacent positive-duration window.
    if (intersects(left) && intersects(right)) overlap(leftEdge, rightEdge)
    else if (intersects(left) && right.value === 0 && right.indeterminateMargin === 0) overlap(leftEdge, rightEdge)
    else if (left.value === 0 && left.indeterminateMargin === 0 && intersects(right)) overlap(leftEdge, rightEdge)
    else if (crossing) {
      if (intersects(left)) overlap(leftEdge, crossing)
      else overlap(crossing, rightEdge)
    }
    leftTime = rightTime; left = right
  }
  cancelled()
  contacts.sort((a, b) => a.elapsedTdbSeconds-b.elapsedTdbSeconds)
  const sampledInterceptWindows: SampledInterceptWindow[] = spans.map(({ start, end }) => ({
    boundary: 'ellipsoid-limb', start, end, durationSeconds: end.elapsedTdbSeconds-start.elapsedTdbSeconds,
    numericalDurationBoundsSeconds: [Math.max(0, end.bracketSeconds[0]-start.bracketSeconds[1]), end.bracketSeconds[1]-start.bracketSeconds[0]] as [number, number],
  }))
  return {
    contacts, evaluations, startSeconds, endSeconds, toleranceSeconds, sampledInterceptWindows, startGapScaled, endGapScaled: left.value,
    scanIntervals: intervals, requestedMaxStepSeconds: maxStepSeconds, maximumScanIntervalSeconds,
    coverage: indeterminateSamples.length ? 'sampled-with-numerically-indeterminate-points' as const : 'sampled-sign-changes-only' as const,
    possibleMissedEvents: true as const, indeterminateSamples, numericallyScreenedCrossings,
    limitations: ['A grazing tangency or multiple crossings wholly between adjacent samples may be missed.',
      'No contact found does not prove the ray never intersected the body; scan spacing is not a completeness guarantee.',
      'Samples inside the ellipsoid-ray numerical screening margin have no trusted sign; affected intervals do not contribute contacts or intercept windows.',
      'A sign-changing scan interval whose refinement enters the screening margin is retained as a numerically screened candidate, not a localized contact.',
      'Contact brackets and tolerance describe scalar-root localization only, not physical timing uncertainty.',
      'A sampled zero is not classified as a crossing or tangency without additional local evidence.',
      'Intercept windows infer negative signed-gap spans from sampled signs; unsampled gaps may split them and search-boundary edges are clipped.',
      'Source failures, cancellation and exhausted budgets reject the search rather than return a partial success.'],
  }
}
