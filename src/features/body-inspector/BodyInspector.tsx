import { useMemo } from 'react'
import { BODY_PHYSICAL } from '../../data/physical'
import { computeMoonPhase } from '../../engine/ephemeris/moonPhase'
import { computeInfluenceRadii } from '../../engine/ephemeris/spheresOfInfluence'
import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { createBodyPositionResolver, getInstantaneousElements } from '../../lib/ephemeris'
import { useI18n } from '../../i18n/context'
import type { BodyId, CelestialBody, RenderedBodyPosition } from '../../types'
import { bodyDisplayName } from '../../lib/bodyNames'

type Props = {
  body: CelestialBody | null
  currentPositions: RenderedBodyPosition[]
  bodiesById: Map<BodyId, CelestialBody>
}

export function BodyInspector({ body, currentPositions, bodiesById }: Props) {
  const { t, language } = useI18n()
  const clock = useSimulationClock()
  const details = useMemo(() => {
    if (!body?.orbit) return null
    const elements = getInstantaneousElements(body.orbit, clock.julianDay)
    const physical = BODY_PHYSICAL[body.id]
    const parentPhysical = BODY_PHYSICAL[body.parentId ?? 'sun']
    const influence = physical && parentPhysical
      ? computeInfluenceRadii(elements.semiMajorAxisAU, elements.eccentricity, physical.massKg, parentPhysical.massKg)
      : null
    return {
      ...elements,
      perihelionAU: elements.semiMajorAxisAU * (1 - elements.eccentricity),
      aphelionAU: elements.semiMajorAxisAU * (1 + elements.eccentricity),
      periodDays: 365.2568983 * Math.sqrt(elements.semiMajorAxisAU ** 3),
      influence,
    }
  }, [body, clock.julianDay])
  const moonPhase = useMemo(() => {
    if (body?.id !== 'moon') return null
    const resolve = createBodyPositionResolver(bodiesById, clock.julianDay)
    return computeMoonPhase(resolve('sun'), resolve('earth'), resolve('moon'))
  }, [bodiesById, body?.id, clock.julianDay])
  const position = body ? currentPositions.find((item) => item.body.id === body.id) : null
  const modelDescription = !body?.orbit
    ? body?.kind === 'star'
      ? 'Heliocentric coordinate origin'
      : body?.kind === 'spacecraft'
        ? 'Schematic sampled teaching trajectory; not an operational ephemeris'
        : 'No orbital propagation model'
    : body.orbit.model === 'planetaryApprox'
      ? 'JPL approximate mean elements + secular rates'
      : 'Elliptic two-body Kepler propagation'

  return (
    <aside className="inspector-panel glass-panel">
      <div className="section-kicker">{t('bodyInspector').toUpperCase()}</div>
      {!body ? <p className="muted-copy">{t('noBody')}</p> : (
        <>
          <header className="inspector-header">
            <i style={{ background: body.color }} />
            <div><h2>{bodyDisplayName(body, language)}</h2><p>{body.orbitClassName ?? body.kind}</p></div>
          </header>
          <div className="metric-grid compact">
            <Metric label={t('distance')} value={position ? `${position.distance.toFixed(position.distance < 0.1 ? 5 : 3)} AU` : '—'} />
            <Metric label={t('source')} value={body.source.toUpperCase()} />
            {details && <>
              <Metric label={t('semiMajorAxis')} value={`${details.semiMajorAxisAU.toFixed(5)} AU`} />
              <Metric label={t('eccentricity')} value={details.eccentricity.toFixed(6)} />
              <Metric label={t('inclination')} value={`${details.inclinationDeg.toFixed(3)}°`} />
              <Metric label={t('perihelion')} value={`${details.perihelionAU.toFixed(4)} AU`} />
              <Metric label={t('aphelion')} value={`${details.aphelionAU.toFixed(4)} AU`} />
              <Metric label={t('timeOfFlight')} value={`${details.periodDays.toFixed(1)} d`} />
            </>}
            {body.absoluteMagnitude !== undefined && <Metric label={t('absoluteMagnitude')} value={body.absoluteMagnitude.toFixed(2)} />}
          </div>
          {moonPhase && (
            <div className="science-callout moon-callout">
              <span className="moon-disc" style={{ '--illumination': moonPhase.illuminatedFraction } as React.CSSProperties}>◐</span>
              <div><strong>{t('moonPhase')}</strong><p>{(moonPhase.illuminatedFraction * 100).toFixed(1)}% {t('illuminated')} · {moonPhase.name}</p></div>
            </div>
          )}
          {details?.influence && (
            <div className="definition-list">
              <div><span>{t('hill')}</span><strong>{details.influence.hillRadiusAU.toExponential(3)} AU</strong></div>
              <div><span>{t('soi')}</span><strong>{details.influence.laplaceSoiRadiusAU.toExponential(3)} AU</strong></div>
            </div>
          )}
          <div className="model-note">
            <b>{t('model')}</b>
            <p>{modelDescription}</p>
            <small>{body.dataEpochLabel ?? (body.orbit?.model === 'keplerian' ? `JD ${body.orbit.epochJd}` : body.orbit?.model === 'planetaryApprox' ? 'J2000 secular approximation' : 'Model-specific reference')}</small>
          </div>
        </>
      )}
    </aside>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>
}
