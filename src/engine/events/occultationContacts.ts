import { trajectoryScanIntervals } from './trajectoryEvents.ts'

type Gaps = { externalGapRadians: number; internalGapRadians: number }
export const OCCULTATION_MAX_EVALUATIONS = 20_000

export function occultationScanIntervalCount(
  durationSeconds: number,
  maxStepSeconds: number,
  startSeconds = 0,
  endSeconds = startSeconds + durationSeconds,
  maxEvaluations = OCCULTATION_MAX_EVALUATIONS,
) {
  return trajectoryScanIntervals(durationSeconds, maxStepSeconds, startSeconds, endSeconds, maxEvaluations)
}

export type OccultationContact = {
  boundary: 'external' | 'internal'
  direction: 'enter' | 'exit' | 'sampled-zero'
  elapsedTdbSeconds: number
  scanBracketSeconds: [number, number]
  bracketSeconds: [number, number]
}
type WindowEdge = {
  elapsedTdbSeconds: number
  bracketSeconds: [number, number]
  kind: 'search-boundary' | 'sampled-overlap' | 'sampled-zero' | 'bracketed-contact'
}
export type SampledOverlapWindow = {
  boundary: 'external' | 'internal'
  start: WindowEdge
  end: WindowEdge
  durationSeconds: number
  numericalDurationBoundsSeconds: [number, number]
}

/** Bounded sampled sign-change search. It does not certify absence of grazing
 * contacts or events shorter than a scan interval; this remains explicit even
 * when no contacts are found. Evaluators must use one frozen source contract. */
export async function findOccultationContacts(options: {
  evaluate: (elapsedTdbSeconds: number) => Gaps
  startSeconds: number; endSeconds: number; maxStepSeconds: number; toleranceSeconds: number
  maxEvaluations?: number; maxContacts?: number; signal?: AbortSignal
}) {
  const { evaluate, startSeconds, endSeconds, maxStepSeconds, toleranceSeconds, signal,
    maxEvaluations = OCCULTATION_MAX_EVALUATIONS, maxContacts = 512 } = options
  const duration = endSeconds-startSeconds
  if (![startSeconds, endSeconds, duration, maxStepSeconds, toleranceSeconds].every(Number.isFinite) || duration < 0 || maxStepSeconds <= 0 || toleranceSeconds <= 0 || toleranceSeconds > maxStepSeconds ||
      !Number.isSafeInteger(maxEvaluations) || maxEvaluations < 2 || maxEvaluations > 200000 || !Number.isSafeInteger(maxContacts) || maxContacts < 1 || maxContacts > 4096) throw new RangeError('Invalid bounded occultation search settings')
  // A positive duration/max-step ratio can underflow to zero. Every nonempty
  // window still needs both endpoint evaluations and one scan interval.
  const intervals = occultationScanIntervalCount(duration, maxStepSeconds, startSeconds, endSeconds, maxEvaluations)
  if (!Number.isSafeInteger(intervals) || intervals+1 > maxEvaluations) throw new RangeError('Occultation scan exceeds the evaluation budget')
  let evaluations = 0, maximumScanIntervalSeconds = 0
  const cancelled = () => { if (signal?.aborted) throw new DOMException('Occultation search cancelled', 'AbortError') }
  const sample = async (time: number) => {
    cancelled()
    if (evaluations >= maxEvaluations) throw new RangeError('Occultation refinement exceeds the evaluation budget')
    if (evaluations && evaluations%64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); cancelled() }
    evaluations++
    const value = evaluate(time)
    if (![value.externalGapRadians, value.internalGapRadians].every(Number.isFinite)) throw new RangeError('Occultation source returned nonfinite gaps')
    cancelled()
    return { external: value.externalGapRadians, internal: value.internalGapRadians }
  }
  const contacts: OccultationContact[] = []
  const spans: Record<'external' | 'internal', { start: WindowEdge; end: WindowEdge }[]> = { external: [], internal: [] }
  const edge = (time: number, kind: WindowEdge['kind'], bracket: [number, number] = [time, time]): WindowEdge => {
    const clippedSample = (time === startSeconds || time === endSeconds) && bracket[0] === time && bracket[1] === time
    return { elapsedTdbSeconds: time, bracketSeconds: [...bracket], kind: clippedSample ? 'search-boundary' : kind }
  }
  const overlap = (boundary: 'external' | 'internal', start: WindowEdge, end: WindowEdge) => {
    if (!(end.elapsedTdbSeconds > start.elapsedTdbSeconds)) return
    const previous = spans[boundary].at(-1)
    if (previous?.end.elapsedTdbSeconds === start.elapsedTdbSeconds) previous.end = end
    else spans[boundary].push({ start, end })
  }
  const add = (contact: OccultationContact) => {
    if (contacts.length >= maxContacts) throw new RangeError('Occultation contacts exceed the result budget')
    contacts.push(contact)
  }
  const boundaries = ['external', 'internal'] as const
  let leftTime = startSeconds, left = await sample(startSeconds)
  const startGapsRadians = { ...left }
  for (const boundary of boundaries) if (left[boundary] === 0) add({ boundary, direction: 'sampled-zero', elapsedTdbSeconds: leftTime,
    scanBracketSeconds: [leftTime, leftTime], bracketSeconds: [leftTime, leftTime] })
  for (let i = 1; i <= intervals; i++) {
    const rightTime = i === intervals ? endSeconds : startSeconds+(duration/intervals)*i
    if (!(rightTime > leftTime)) throw new RangeError('Occultation scan interval is below the epoch numerical resolution')
    const scanInterval = rightTime - leftTime
    if (scanInterval > maxStepSeconds) throw new RangeError('Occultation scan interval exceeds its configured maximum')
    maximumScanIntervalSeconds = Math.max(maximumScanIntervalSeconds, scanInterval)
    const right = await sample(rightTime)
    for (const boundary of boundaries) {
      let crossing: WindowEdge | undefined
      if (right[boundary] === 0) add({ boundary, direction: 'sampled-zero', elapsedTdbSeconds: rightTime,
        scanBracketSeconds: [rightTime, rightTime], bracketSeconds: [rightTime, rightTime] })
      else if (left[boundary] !== 0 && (left[boundary] < 0) !== (right[boundary] < 0)) {
        let lo = leftTime, hi = rightTime, lowValue = left[boundary]
        while (hi-lo > toleranceSeconds) {
          const middle = lo+(hi-lo)/2
          if (!(middle > lo && middle < hi)) throw new RangeError('Contact tolerance is below the epoch numerical resolution')
          const value = (await sample(middle))[boundary]
          if (value === 0) { lo = middle; hi = middle; break }
          if ((value < 0) === (lowValue < 0)) { lo = middle; lowValue = value } else hi = middle
        }
        add({ boundary, direction: left[boundary] > 0 ? 'enter' : 'exit', elapsedTdbSeconds: lo+(hi-lo)/2,
          scanBracketSeconds: [leftTime, rightTime], bracketSeconds: [lo, hi] })
        crossing = edge(lo+(hi-lo)/2, 'bracketed-contact', [lo, hi])
      }
      // Infer spans from sampled signs, never from an assumed alternation of
      // contacts. A sampled zero alone does not establish a positive-duration event.
      const leftEdge = edge(leftTime, left[boundary] === 0 ? 'sampled-zero' : 'sampled-overlap')
      const rightEdge = edge(rightTime, right[boundary] === 0 ? 'sampled-zero' : 'sampled-overlap')
      if (left[boundary] < 0 && right[boundary] <= 0 || left[boundary] <= 0 && right[boundary] < 0) overlap(boundary, leftEdge, rightEdge)
      else if (crossing) {
        if (left[boundary] < 0) overlap(boundary, leftEdge, crossing)
        else overlap(boundary, crossing, rightEdge)
      }
    }
    leftTime = rightTime; left = right
  }
  cancelled()
  contacts.sort((a, b) => a.elapsedTdbSeconds-b.elapsedTdbSeconds || a.boundary.localeCompare(b.boundary))
  const sampledOverlapWindows: SampledOverlapWindow[] = boundaries.flatMap(boundary => spans[boundary].map(({ start, end }) => ({
    boundary, start, end, durationSeconds: end.elapsedTdbSeconds-start.elapsedTdbSeconds,
    numericalDurationBoundsSeconds: [Math.max(0, end.bracketSeconds[0]-start.bracketSeconds[1]), end.bracketSeconds[1]-start.bracketSeconds[0]] as [number, number],
  }))).sort((a, b) => a.start.elapsedTdbSeconds-b.start.elapsedTdbSeconds || a.boundary.localeCompare(b.boundary))
  return { contacts, evaluations, startSeconds, endSeconds, toleranceSeconds,
    sampledOverlapWindows,
    startGapsRadians, endGapsRadians: { ...left },
    scanIntervals: intervals, requestedMaxStepSeconds: maxStepSeconds, maximumScanIntervalSeconds,
    coverage: 'sampled-sign-changes-only' as const, possibleMissedEvents: true,
    limitations: ['Grazing contacts and multiple crossings wholly between adjacent samples may be missed.',
      'No contacts found does not prove that no event occurred; scan spacing is not a completeness guarantee.',
      'Brackets and tolerance describe numerical root localization, not physical timing uncertainty.',
      'A sampled zero is not classified as a crossing or tangency without additional local evidence.',
      'Overlap windows infer negative-gap spans from the sampled signs. Unsampled gaps may split them; search-boundary edges are clipped, and zero-only spans have no inferred duration.',
      'Source failures, cancellation and exhausted budgets reject the search rather than return a partial success.'],
  }
}
