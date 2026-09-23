type Gaps = { externalGapRadians: number; internalGapRadians: number }
export type OccultationContact = {
  boundary: 'external' | 'internal'
  direction: 'enter' | 'exit' | 'sampled-zero'
  elapsedTdbSeconds: number
  bracketSeconds: [number, number]
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
    maxEvaluations = 20000, maxContacts = 512 } = options
  const duration = endSeconds-startSeconds
  if (![startSeconds, endSeconds, duration, maxStepSeconds, toleranceSeconds].every(Number.isFinite) || duration < 0 || maxStepSeconds <= 0 || toleranceSeconds <= 0 || toleranceSeconds > maxStepSeconds ||
      !Number.isSafeInteger(maxEvaluations) || maxEvaluations < 2 || maxEvaluations > 200000 || !Number.isSafeInteger(maxContacts) || maxContacts < 1 || maxContacts > 4096) throw new RangeError('Invalid bounded occultation search settings')
  const intervals = Math.ceil(duration/maxStepSeconds)
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
  const add = (contact: OccultationContact) => {
    if (contacts.length >= maxContacts) throw new RangeError('Occultation contacts exceed the result budget')
    contacts.push(contact)
  }
  const boundaries = ['external', 'internal'] as const
  let leftTime = startSeconds, left = await sample(startSeconds)
  const startGapsRadians = { ...left }
  for (const boundary of boundaries) if (left[boundary] === 0) add({ boundary, direction: 'sampled-zero', elapsedTdbSeconds: leftTime, bracketSeconds: [leftTime, leftTime] })
  for (let i = 1; i <= intervals; i++) {
    const rightTime = i === intervals ? endSeconds : startSeconds+(duration/intervals)*i
    if (!(rightTime > leftTime)) throw new RangeError('Occultation scan interval is below the epoch numerical resolution')
    maximumScanIntervalSeconds = Math.max(maximumScanIntervalSeconds, rightTime-leftTime)
    const right = await sample(rightTime)
    for (const boundary of boundaries) {
      if (right[boundary] === 0) add({ boundary, direction: 'sampled-zero', elapsedTdbSeconds: rightTime, bracketSeconds: [rightTime, rightTime] })
      else if (left[boundary] !== 0 && (left[boundary] < 0) !== (right[boundary] < 0)) {
        let lo = leftTime, hi = rightTime, lowValue = left[boundary]
        while (hi-lo > toleranceSeconds) {
          const middle = lo+(hi-lo)/2
          if (!(middle > lo && middle < hi)) throw new RangeError('Contact tolerance is below the epoch numerical resolution')
          const value = (await sample(middle))[boundary]
          if (value === 0) { lo = middle; hi = middle; break }
          if ((value < 0) === (lowValue < 0)) { lo = middle; lowValue = value } else hi = middle
        }
        add({ boundary, direction: left[boundary] > 0 ? 'enter' : 'exit', elapsedTdbSeconds: lo+(hi-lo)/2, bracketSeconds: [lo, hi] })
      }
    }
    leftTime = rightTime; left = right
  }
  cancelled()
  contacts.sort((a, b) => a.elapsedTdbSeconds-b.elapsedTdbSeconds || a.boundary.localeCompare(b.boundary))
  return { contacts, evaluations, startSeconds, endSeconds, toleranceSeconds,
    startGapsRadians, endGapsRadians: { ...left },
    scanIntervals: intervals, requestedMaxStepSeconds: maxStepSeconds, maximumScanIntervalSeconds,
    coverage: 'sampled-sign-changes-only' as const, possibleMissedEvents: true,
    limitations: ['Grazing contacts and multiple crossings wholly between adjacent samples may be missed.',
      'No contacts found does not prove that no event occurred; scan spacing is not a completeness guarantee.',
      'Brackets and tolerance describe numerical root localization, not physical timing uncertainty.',
      'A sampled zero is not classified as a crossing or tangency without additional local evidence.',
      'Source failures, cancellation and exhausted budgets reject the search rather than return a partial success.'],
  }
}
