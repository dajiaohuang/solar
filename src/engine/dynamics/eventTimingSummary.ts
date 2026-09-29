import type { EnsembleDistanceEventDraw } from './ensembleDistanceEvents'

/** Describes a finite detected subset, without inferring physical event identity
 * across draws or treating failed/missing samples as event-free. */
export function summarizeFirstDetectedEventTimes(draws: readonly EnsembleDistanceEventDraw[]) {
  if (!draws.length || draws.length > 128) throw new RangeError('Bounded event draw set required')
  const summaries = (['decreasing','increasing'] as const).map(direction => {
    const selections: { index: number; eventIndex: number; elapsedTdbSeconds: number; bracketSeconds: [number,number] }[] = []
    const exclusions: { index: number; reason: 'failed' | 'unresolved' | 'not-detected' | 'earlier-unclassified-zero' }[] = []
    for (const [index,draw] of draws.entries()) {
      if (draw.index !== index) throw new RangeError('Event timing requires complete ordered draw identities')
      if (draw.status !== 'searched') {
        if (draw.status !== 'failed' && draw.status !== 'unresolved') throw new RangeError('Invalid event draw status')
        exclusions.push({index,reason:draw.status}); continue
      }
      const events = draw.result.search.events
      if (events.length > 128) throw new RangeError('Event timing input exceeds result limit')
      let previous = -Infinity
      for (const event of events) {
        const [low,high] = event.localizationBracketSeconds
        if (![event.elapsedTdbSeconds,low,high].every(Number.isFinite) || low > event.elapsedTdbSeconds || high < event.elapsedTdbSeconds ||
            event.elapsedTdbSeconds !== low+(high-low)/2 || event.elapsedTdbSeconds < previous) {
          throw new RangeError('Invalid event timing localization')
        }
        previous = event.elapsedTdbSeconds
      }
      const eventIndex = events.findIndex(event => event.kind === 'sign-change' && event.direction === direction)
      const chosen = events[eventIndex]
      if (events.some(event => event.kind === 'sampled-zero' && (!chosen || event.elapsedTdbSeconds <= chosen.elapsedTdbSeconds))) {
        exclusions.push({index,reason:'earlier-unclassified-zero'}); continue
      }
      if (!chosen) { exclusions.push({index,reason:'not-detected'}); continue }
      selections.push({index,eventIndex,elapsedTdbSeconds:chosen.elapsedTdbSeconds,bracketSeconds:[...chosen.localizationBracketSeconds]})
    }
    const times = selections.map(value => value.elapsedTdbSeconds).sort((a,b) => a-b)
    const lower = selections.map(value => value.bracketSeconds[0]).sort((a,b) => a-b)
    const upper = selections.map(value => value.bracketSeconds[1]).sort((a,b) => a-b)
    // Nearest-rank order statistics; no interpolation and no large-JD addition.
    // Sorting each bound separately encloses the order statistic despite rank
    // changes among overlapping localization intervals.
    const quantiles = times.length < 2 ? null : [.05,.5,.95].map(fraction => {
      const rank = Math.ceil(fraction*times.length), index = rank-1
      return {fraction,rank,elapsedTdbSeconds:times[index],localizationBoundsSeconds:[lower[index],upper[index]] as [number,number]}
    })
    return {direction,eventSelection:'first-detected-in-chronological-order' as const,
      counts:{total:draws.length,selected:selections.length,
        failed:exclusions.filter(value => value.reason === 'failed').length,
        unresolved:exclusions.filter(value => value.reason === 'unresolved').length,
        notDetected:exclusions.filter(value => value.reason === 'not-detected').length,
        ambiguousZero:exclusions.filter(value => value.reason === 'earlier-unclassified-zero').length},
      selections,exclusions,status:quantiles ? 'available' as const : 'insufficient-selected-draws' as const,quantiles}
  })
  return {method:'conditional-first-detected-nearest-rank-times-v1' as const,summaries,
    limitations:[
      'Conditional descriptive order statistics of selected finite draws only; not a population confidence interval, event probability or calibrated physical uncertainty.',
      'First means earliest detected time in the chronological search window, including negative-duration searches, not first along integration direction.',
      'Direction is defined by sampled signs. Multiple crossings within one scan interval may be missed; no unique physical-event correspondence across draws is asserted.',
      'A sampled unclassified zero preceding a candidate excludes that draw from first-event timing rather than assigning it a direction.',
      'Failed, unresolved, not-detected and ambiguous draws retain separate identities; none is assigned a timing value or treated as event-free.',
      'Quantile localization bounds cover reported numerical brackets only and exclude integration, sampling and physical-model uncertainty.',
      'At least two selected draws are required for this summary; this threshold does not establish convergence or adequate tail sampling.',
    ]}
}
