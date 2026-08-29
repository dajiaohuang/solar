import { useMemo, useState } from 'react'
import { BODY_PROFILES, fallbackBodyProfile } from '../../content/bodyProfiles'
import { BODY_PHYSICAL } from '../../data/physical'
import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { computeMoonPhase } from '../../engine/ephemeris/moonPhase'
import { computeInfluenceRadii } from '../../engine/ephemeris/spheresOfInfluence'
import { useI18n } from '../../i18n/context'
import { bodyDisplayName } from '../../lib/bodyNames'
import { createBodyPositionResolver, getInstantaneousElements } from '../../lib/ephemeris'
import { getOrbitalPeriodDays } from '../../lib/orbitalPeriod'
import { encodeCurrentScene } from '../../lib/shareScene'
import { catalogStore } from '../../state/catalog-store'
import { uiActions } from '../../state/ui-store'
import type { BodyId, CelestialBody, RenderedBodyPosition } from '../../types'

type Props = { body: CelestialBody | null; currentPositions: RenderedBodyPosition[]; bodiesById: Map<BodyId, CelestialBody> }
type Tab = 'overview' | 'orbit' | 'physical' | 'context' | 'sources'

const TABS: Tab[] = ['overview', 'orbit', 'physical', 'context', 'sources']

export function BodyInspector({ body, currentPositions, bodiesById }: Props) {
  const { t, language } = useI18n()
  const clock = useSimulationClock()
  const catalog = catalogStore.useStore()
  const [tab, setTab] = useState<Tab>('overview')
  const details = useMemo(() => {
    if (!body?.orbit) return null
    const elements = getInstantaneousElements(body.orbit, clock.julianDay)
    const physical = BODY_PHYSICAL[body.id]
    const parentPhysical = BODY_PHYSICAL[body.parentId ?? 'sun']
    return {
      ...elements,
      perihelionAU: elements.semiMajorAxisAU * (1 - elements.eccentricity),
      aphelionAU: elements.semiMajorAxisAU * (1 + elements.eccentricity),
      periodDays: getOrbitalPeriodDays(
        body.orbit,
        body.parentId ? 'parent' : 'sun',
        elements.semiMajorAxisAU,
      ),
      influence: physical && parentPhysical ? computeInfluenceRadii(elements.semiMajorAxisAU, elements.eccentricity, physical.massKg, parentPhysical.massKg) : null,
    }
  }, [body, clock.julianDay])
  const moonPhase = useMemo(() => {
    if (body?.id !== 'moon') return null
    const resolve = createBodyPositionResolver(bodiesById, clock.julianDay)
    return computeMoonPhase(resolve('sun'), resolve('earth'), resolve('moon'))
  }, [bodiesById, body?.id, clock.julianDay])
  const position = body ? currentPositions.find((item) => item.body.id === body.id) : null
  const physical = body ? BODY_PHYSICAL[body.id] : null
  const profile = body ? BODY_PROFILES[body.id] ?? { ...fallbackBodyProfile(body.kind, body.orbitClassName), sources: [] } : null
  const modelDescription = !body?.orbit ? body?.kind === 'star' ? t('heliocentricOrigin') : body?.kind === 'spacecraft' ? t('schematicTrajectoryModel') : t('noPropagationModel') : body.orbit.model === 'planetaryApprox' ? t('jplApproxModel') : t('ellipticTwoBodyModel')
  const phaseNames = { 'new': t('phaseNew'), 'waxing-crescent': t('phaseWaxingCrescent'), 'first-quarter': t('phaseFirstQuarter'), 'waxing-gibbous': t('phaseWaxingGibbous'), 'full': t('phaseFull'), 'waning-gibbous': t('phaseWaningGibbous'), 'last-quarter': t('phaseLastQuarter'), 'waning-crescent': t('phaseWaningCrescent') }
  const kindLabels = body ? { star: t('bodyKindStar'), planet: t('bodyKindPlanet'), moon: t('bodyKindMoon'), dwarfPlanet: t('bodyKindDwarfPlanet'), asteroid: t('bodyKindAsteroid'), spacecraft: t('bodyKindSpacecraft') } : null
  const profileId = `profile-${(body?.id ?? 'none').replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const panelProps = (item: Tab) => ({ id: `${profileId}-panel-${item}`, 'aria-labelledby': `${profileId}-tab-${item}`, role: 'tabpanel' as const })

  function handleTabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    else return
    event.preventDefault()
    setTab(TABS[next])
    window.requestAnimationFrame(() => document.getElementById(`${profileId}-tab-${TABS[next]}`)?.focus())
  }

  return <aside className="inspector-panel glass-panel">
    <div className="section-kicker">{t('bodyInspector').toUpperCase()}</div>
    {!body || !profile || !kindLabels ? <p className="muted-copy">{t('noBody')}</p> : <>
      <header className="inspector-header"><i style={{ background: body.color }} /><div><h2>{bodyDisplayName(body, language)}</h2><p>{body.orbitClassName ?? kindLabels[body.kind]}</p></div></header>
      <div className="inspector-tabs" role="tablist" aria-label={t('bodyProfileSections')}>{TABS.map((item, index) => <button id={`${profileId}-tab-${item}`} role="tab" aria-controls={`${profileId}-panel-${item}`} aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)} onKeyDown={(event) => handleTabKey(event, index)}>{t(({ overview: 'profileOverview', orbit: 'profileOrbit', physical: 'profilePhysical', context: 'profileContext', sources: 'profileSources' } as const)[item])}</button>)}</div>

      {tab === 'overview' && <section className="profile-section" {...panelProps('overview')}><p className="profile-lead">{profile.overview[language]}</p><div className="science-callout"><span aria-hidden="true">◎</span><div><strong>{t('whyItMatters')}</strong><p>{profile.significance[language]}</p></div></div><div className="metric-grid compact"><Metric label={t('source')} value={body.source.toUpperCase()} /><Metric label={t('orbitClass')} value={body.orbitClassCode ?? kindLabels[body.kind]} />{body.absoluteMagnitude !== undefined && <Metric label={t('absoluteMagnitude')} value={body.absoluteMagnitude.toFixed(2)} />}<Metric label={t('distance')} value={position ? `${position.distance.toFixed(position.distance < .1 ? 5 : 3)} AU` : '—'} /></div></section>}

      {tab === 'orbit' && <section className="profile-section" {...panelProps('orbit')}>{details ? <div className="metric-grid compact"><Metric label={t('semiMajorAxis')} value={`${details.semiMajorAxisAU.toFixed(5)} AU`} /><Metric label={t('eccentricity')} value={details.eccentricity.toFixed(6)} /><Metric label={t('inclination')} value={`${details.inclinationDeg.toFixed(3)}°`} /><Metric label={t('perihelion')} value={`${details.perihelionAU.toFixed(4)} AU`} /><Metric label={t('aphelion')} value={`${details.aphelionAU.toFixed(4)} AU`} /><Metric label={t('orbitalPeriod')} value={`${details.periodDays.toFixed(1)} d`} /></div> : <p className="muted-copy">{t('noPropagationModel')}</p>}<div className="model-note"><b>{t('model')}</b><p>{modelDescription}</p><small>{body.dataEpochLabel ?? (body.orbit?.model === 'keplerian' ? `JD ${body.orbit.epochJd}` : body.orbit?.model === 'planetaryApprox' ? t('j2000Approximation') : t('modelSpecificReference'))}</small></div></section>}

      {tab === 'physical' && <section className="profile-section" {...panelProps('physical')}>{physical ? <div className="metric-grid compact"><Metric label={t('mass')} value={`${physical.massKg.toExponential(5)} kg`} /><Metric label={t('meanRadius')} value={`${physical.radiusKm.toLocaleString()} km`} /><Metric label={t('diameter')} value={`${(physical.radiusKm * 2).toLocaleString()} km`} /></div> : <p className="muted-copy">{t('physicalDataUnavailable')}</p>}{moonPhase && <div className="science-callout moon-callout"><span className="moon-disc">◐</span><div><strong>{t('moonPhase')}</strong><p>{(moonPhase.illuminatedFraction * 100).toFixed(1)}% {t('illuminated')} · {phaseNames[moonPhase.name]}</p></div></div>}{details?.influence && <div className="definition-list"><div><span>{t('hill')}</span><strong>{details.influence.hillRadiusAU.toExponential(3)} AU</strong></div><div><span>{t('soi')}</span><strong>{details.influence.laplaceSoiRadiusAU.toExponential(3)} AU</strong></div></div>}</section>}

      {tab === 'context' && <section className="profile-section" {...panelProps('context')}><div className="definition-list"><div><span>{t('parentBody')}</span><strong>{body.parentId ? bodyDisplayName(bodiesById.get(body.parentId) ?? { ...body, id: body.parentId, name: body.parentId }, language) : t('heliocentricOrigin')}</strong></div><div><span>{t('dataset')}</span><strong>{body.isCatalogBody ? catalog.datasetVersion : t('curatedBodies')}</strong></div>{body.orbitUncertainty && <div><span>{t('uncertaintyCode')}</span><strong>{body.orbitUncertainty}</strong></div>}</div>{body.orbitClassCode && ['APO', 'ATE', 'AMO', 'ATI'].includes(body.orbitClassCode) && <div className="error-banner">{t('orbitClassNotRisk')}</div>}<div className="profile-actions"><button onClick={() => uiActions.navigate('elements')}>{t('openElementContext')}</button><button onClick={() => uiActions.navigate('events')}>{t('openEventsContext')}</button><button onClick={() => uiActions.navigate('catalog')}>{t('openCatalogContext')}</button></div></section>}

      {tab === 'sources' && <section className="profile-section" {...panelProps('sources')}><div className="source-list"><a href="https://ssd.jpl.nasa.gov/planets/approx_pos.html" target="_blank" rel="noreferrer">JPL approximate positions ↗</a>{body.isCatalogBody && <a href="https://www.minorplanetcenter.net/iau/MPCORB.html" target="_blank" rel="noreferrer">Minor Planet Center MPCORB ↗</a>}{profile.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label} ↗</a>)}</div><p className="fine-print">{t('profileSourceBoundary')}</p><a className="report-object-link" href={`https://github.com/dajiaohuang/solar/issues/new?template=data-error.yml&title=${encodeURIComponent(`Object report: ${bodyDisplayName(body, 'en')}`)}&body=${encodeURIComponent(`Object: ${body.id}\nDataset: ${catalog.datasetVersion}\nScene: ${encodeCurrentScene()}`)}`} target="_blank" rel="noreferrer">{t('reportThisObject')} ↗</a></section>}
    </>}
  </aside>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }
