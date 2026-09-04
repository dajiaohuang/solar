import { useMemo, useState } from 'react'
import { BODY_PROFILES, fallbackBodyProfile } from '../../content/bodyProfiles'
import { BODY_PHYSICAL } from '../../data/physical'
import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { computeMoonPhase } from '../../engine/ephemeris/moonPhase'
import { computeInfluenceRadii } from '../../engine/ephemeris/spheresOfInfluence'
import { kernelCoverage, EPHEMERIS_MANIFEST } from '../../engine/ephemeris/kernelStore'
import { useEphemerides } from '../../hooks/useEphemerides'
import { currentOsculatingElements } from '../../engine/ephemeris/diagnostics'
import { ObservationReadout } from './ObservationReadout'
import { SatelliteIdentityReadout } from './SatelliteIdentityReadout'
import { simulationStore } from '../../state/simulation-store'
import { useI18n } from '../../i18n/context'
import { bodyDisplayName } from '../../lib/bodyNames'
import { bodyPositionOrNull, createBodyPositionResolver, getInstantaneousElements } from '../../lib/ephemeris'
import { formatDistanceAU, formatPeriodDays } from '../../lib/formatDistance'
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
  const ephemerides = useEphemerides()
  const { referenceId, viewMode } = simulationStore.useStore()
  const observer = bodiesById.get(referenceId)
  const hasEphemeris = body ? kernelCoverage(body, clock.julianDay).model === 'jpl-spk' : false
  const catalog = catalogStore.useStore()
  const [tab, setTab] = useState<Tab>('overview')
  const details = useMemo(() => {
    void ephemerides.revision // The external kernel pool can change while paused.
    if (!body) return null
    const parent = bodiesById.get(body.parentId ?? 'sun')
    const osculating = parent ? currentOsculatingElements(body, parent, clock.julianDay) : null
    const elements = osculating ?? (body.orbit ? getInstantaneousElements(body.orbit, clock.julianDay) : null)
    if (!elements) return null
    const physical = BODY_PHYSICAL[body.id]
    const parentPhysical = BODY_PHYSICAL[body.parentId ?? 'sun']
    return {
      ...elements,
      isOsculating: Boolean(osculating),
      perihelionAU: elements.semiMajorAxisAU * (1 - elements.eccentricity),
      aphelionAU: elements.semiMajorAxisAU * (1 + elements.eccentricity),
      periodDays: osculating ? 360 / osculating.meanMotionDegPerDay : getOrbitalPeriodDays(
        body.orbit!,
        body.parentId ? 'parent' : 'sun',
        elements.semiMajorAxisAU,
      ),
      influence: physical && parentPhysical ? computeInfluenceRadii(elements.semiMajorAxisAU, elements.eccentricity, physical.massKg, parentPhysical.massKg) : null,
    }
  }, [body, bodiesById, clock.julianDay, ephemerides.revision])
  const moonPhase = useMemo(() => {
    if (body?.id !== 'moon') return null
    const resolve = createBodyPositionResolver(bodiesById, clock.julianDay)
    const sun = bodyPositionOrNull(resolve, 'sun')
    const earth = bodyPositionOrNull(resolve, 'earth')
    const moon = bodyPositionOrNull(resolve, 'moon')
    return sun && earth && moon ? computeMoonPhase(sun, earth, moon) : null
  }, [bodiesById, body?.id, clock.julianDay])
  const position = body ? currentPositions.find((item) => item.body.id === body.id) : null
  const physical = body ? BODY_PHYSICAL[body.id] : null
  const profile = body ? BODY_PROFILES[body.id] ?? { ...fallbackBodyProfile(body.kind, body.orbitClassName), sources: [] } : null
  const satelliteEvidence = body?.satelliteOrbitEvidence
  const fallbackDescription = !body?.orbit
    ? body?.kind === 'star' ? t('heliocentricOrigin') : body?.kind === 'spacecraft' ? t('schematicTrajectoryModel') : t('noPropagationModel')
    : satelliteEvidence?.precision === 'fixed-osculating-ellipse-at-epoch-not-ephemeris' ? t('jplHorizonsEpochModel')
    : satelliteEvidence?.precision === 'fixed-mean-ellipse-not-ephemeris' ? t('jplSatelliteMeanModel')
    : satelliteEvidence ? t('illustrativeSatelliteModel')
    : body.orbitRepresents === 'earth-moon-barycenter' ? t('earthOrbitSeedModel')
    : body.orbit.model === 'planetaryApprox' ? t('jplApproxModel') : t('ellipticTwoBodyModel')
  const modelDescription = hasEphemeris ? `${t('physicalEphemerides')} · ${t('geometricStates')}` : fallbackDescription
  const satelliteSourceFrame = satelliteEvidence?.sourceFrame === 'jpl-ecliptic'
    ? t('jplEclipticFrame')
    : t('undocumentedIllustrativeFrame')
  const satelliteSourceCenter = satelliteEvidence?.sourceCenter === 'earth-geocenter'
    ? t('earthGeocenter')
    : satelliteEvidence?.sourceCenter === 'planet-center'
      ? t('planetCenter')
      : t('undocumentedParentCenter')
  const satelliteAppliedCenter = satelliteEvidence?.appliedCenter === 'earth-geocenter' ? t('earthGeocenter') : t('parentRenderedPoint')
  const satelliteCenterHandling = satelliteEvidence?.centerHandling === 'de440-gm-barycentric-partition' ? t('de440MassPartition') : t('directParentAddition')
  const satellitePhaseProvenance = satelliteEvidence?.phaseProvenance === 'jpl-horizons-osculating-elements'
    ? t('jplHorizonsEpochPhase')
    : satelliteEvidence?.phaseProvenance === 'jpl-mean-elements'
      ? t('jplMeanElementsPhase')
      : t('illustrativeZeroPhase')
  const satellitePrecision = satelliteEvidence?.precision === 'fixed-osculating-ellipse-at-epoch-not-ephemeris'
    ? t('fixedEpochEllipseBoundary')
    : satelliteEvidence?.precision === 'fixed-mean-ellipse-not-ephemeris'
      ? t('fixedMeanEllipseBoundary')
      : t('illustrativeFixedEllipseBoundary')
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
      <p className="fine-print" data-testid="body-model">{modelDescription}</p>
      <SatelliteIdentityReadout body={body} />
      {tab === 'sources' && <SatelliteIdentityReadout body={body} sources />}
      {viewMode === '3d' && <p className="fine-print">{t('schematicMarkerScale')}</p>}
      {hasEphemeris && <p className="fine-print">{t('ephemerisBoundary')}</p>}
      {tab === 'orbit' && <p className="fine-print">{t(details?.isOsculating ? 'osculatingElements' : 'seedElementsOnly')}</p>}
      {tab === 'orbit' && observer && <ObservationReadout body={body} observer={observer} julianDay={clock.julianDay} />}
      {tab === 'context' && hasEphemeris && <p className="fine-print">{t('fallbackModelDetails')}</p>}
      {tab === 'sources' && hasEphemeris && <div className="source-list">{EPHEMERIS_MANIFEST.files.filter((file) => file.targets.includes(kernelCoverage(body, clock.julianDay).target ?? -1)).map((file) => <a key={file.id} href={file.source} target="_blank" rel="noreferrer">{file.id} · SHA-256 {file.sha256}</a>)}</div>}
      <div className="inspector-tabs" role="tablist" aria-label={t('bodyProfileSections')}>{TABS.map((item, index) => <button id={`${profileId}-tab-${item}`} role="tab" aria-controls={`${profileId}-panel-${item}`} aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)} onKeyDown={(event) => handleTabKey(event, index)}>{t(({ overview: 'profileOverview', orbit: 'profileOrbit', physical: 'profilePhysical', context: 'profileContext', sources: 'profileSources' } as const)[item])}</button>)}</div>

      {tab === 'overview' && <section className="profile-section" {...panelProps('overview')}><p className="profile-lead">{profile.overview[language]}</p><div className="science-callout"><span aria-hidden="true">◎</span><div><strong>{t('whyItMatters')}</strong><p>{profile.significance[language]}</p></div></div><div className="metric-grid compact"><Metric label={t('source')} value={body.source.toUpperCase()} /><Metric label={t('orbitClass')} value={body.orbitClassCode ?? kindLabels[body.kind]} />{body.absoluteMagnitude !== undefined && <Metric label={t('absoluteMagnitude')} value={body.absoluteMagnitude.toFixed(2)} />}<Metric label={t('distance')} value={position ? formatDistanceAU(position.distance, language === 'zh' ? 'zh-CN' : 'en-US') : '—'} /></div></section>}

      {tab === 'orbit' && <section className="profile-section" {...panelProps('orbit')}>{details ? <div className="metric-grid compact"><Metric label={t('semiMajorAxis')} value={formatDistanceAU(details.semiMajorAxisAU, language === 'zh' ? 'zh-CN' : 'en-US')} /><Metric label={t('eccentricity')} value={details.eccentricity.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', { maximumSignificantDigits: 6 })} /><Metric label={t('inclination')} value={`${details.inclinationDeg.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', { maximumSignificantDigits: 6 })}°`} /><Metric label={body.parentId ? t('periapsis') : t('perihelion')} value={formatDistanceAU(details.perihelionAU, language === 'zh' ? 'zh-CN' : 'en-US')} /><Metric label={body.parentId ? t('apoapsis') : t('aphelion')} value={formatDistanceAU(details.aphelionAU, language === 'zh' ? 'zh-CN' : 'en-US')} /><Metric label={t('orbitalPeriod')} value={formatPeriodDays(details.periodDays, language === 'zh' ? 'zh-CN' : 'en-US')} /></div> : <p className="muted-copy">{t('noPropagationModel')}</p>}<div className="model-note"><b>{t('model')}</b><p>{modelDescription}</p><small>{t('orbitParameterScope')}</small><small>{hasEphemeris ? `JD ${clock.julianDay.toFixed(6)} UTC → TDB` : body.dataEpochLabel ?? (body.orbit?.model === 'keplerian' ? `JD ${body.orbit.epochJd}` : body.orbit?.model === 'planetaryApprox' ? t('j2000Approximation') : t('modelSpecificReference'))}</small></div></section>}

      {tab === 'physical' && <section className="profile-section" {...panelProps('physical')}>{physical ? <div className="metric-grid compact"><Metric label={t('mass')} value={`${physical.massKg.toExponential(5)} kg`} /><Metric label={t('meanRadius')} value={`${physical.radiusKm.toLocaleString()} km`} /><Metric label={t('diameter')} value={`${(physical.radiusKm * 2).toLocaleString()} km`} /></div> : <p className="muted-copy">{t('physicalDataUnavailable')}</p>}{moonPhase && <div className="science-callout moon-callout"><span className="moon-disc">◐</span><div><strong>{t('moonPhase')}</strong><p>{(moonPhase.illuminatedFraction * 100).toFixed(1)}% {t('illuminated')} · {phaseNames[moonPhase.name]}</p></div></div>}{details?.influence && <div className="definition-list"><div><span>{t('hill')}</span><strong>{details.influence.hillRadiusAU.toExponential(3)} AU</strong></div><div><span>{t('soi')}</span><strong>{details.influence.laplaceSoiRadiusAU.toExponential(3)} AU</strong></div></div>}</section>}

      {tab === 'context' && <section className="profile-section" {...panelProps('context')}><div className="definition-list"><div><span>{t('parentBody')}</span><strong>{body.parentId ? bodyDisplayName(bodiesById.get(body.parentId) ?? { ...body, id: body.parentId, name: body.parentId }, language) : t('heliocentricOrigin')}</strong></div>{body.positionRepresents === 'earth-geocenter' && <div><span>{t('positionRepresents')}</span><strong>{hasEphemeris ? t('ephemerisEarthGeocenterPoint') : t('derivedEarthGeocenterPoint')}</strong></div>}{body.orbitRepresents === 'earth-moon-barycenter' && <div><span>{t('orbitRepresents')}</span><strong>{t('earthMoonBarycenterPoint')}</strong></div>}{satelliteEvidence && <><div><span>{t('satelliteSourceFrame')}</span><strong>{satelliteSourceFrame}</strong></div><div><span>{t('appliedFrame')}</span><strong>{t('sceneJ2000EclipticFrame')}</strong></div><div><span>{t('sourceCenter')}</span><strong>{satelliteSourceCenter}</strong></div><div><span>{t('appliedCenter')}</span><strong>{satelliteAppliedCenter}</strong></div><div><span>{t('centerHandling')}</span><strong>{satelliteCenterHandling}</strong></div><div><span>{t('satelliteEpoch')}</span><strong>{satelliteEvidence.epochLabel} · {satelliteEvidence.epochTimeScale === 'TDB' ? 'TDB' : t('unspecifiedTimeScale')}</strong></div><div><span>{t('phaseProvenance')}</span><strong>{satellitePhaseProvenance}</strong></div><div><span>{t('precisionBoundary')}</span><strong>{satellitePrecision}</strong></div></>}<div><span>{t('dataset')}</span><strong>{body.isCatalogBody ? catalog.datasetVersion : t('curatedBodies')}</strong></div>{body.orbitConditionCode && <div><span>{t('orbitConditionCode')}</span><strong>{body.orbitConditionCode}</strong></div>}</div>{body.orbitClassCode && ['APO', 'ATE', 'AMO', 'ATI'].includes(body.orbitClassCode) && <div className="error-banner">{t('orbitClassNotRisk')}</div>}<div className="profile-actions"><button onClick={() => uiActions.navigate('elements')}>{t('openElementContext')}</button><button onClick={() => uiActions.navigate('events')}>{t('openEventsContext')}</button><button onClick={() => uiActions.navigate('catalog')}>{t('openCatalogContext')}</button></div></section>}

      {tab === 'sources' && <section className="profile-section" {...panelProps('sources')}><div className="source-list">{body.orbit?.model === 'planetaryApprox' && <a href="https://ssd.jpl.nasa.gov/planets/approx_pos.html" target="_blank" rel="noreferrer">JPL approximate positions ↗</a>}{body.id === 'earth' && <a href="https://ssd.jpl.nasa.gov/sats/elem/" target="_blank" rel="noreferrer">{t('jplSatelliteMeanElements')} ↗</a>}{satelliteEvidence?.sourceUrl && <a href={satelliteEvidence.sourceUrl} target="_blank" rel="noreferrer">{t('jplSatelliteMeanElements')} ↗</a>}{satelliteEvidence?.sourceQueryUrl && <a href={satelliteEvidence.sourceQueryUrl} target="_blank" rel="noreferrer">{t('jplHorizonsEpochQuery')} ↗</a>}{satelliteEvidence && !satelliteEvidence.sourceUrl && <a href="https://ssd.jpl.nasa.gov/sats/elem/" target="_blank" rel="noreferrer">{t('jplSatelliteComparisonSource')} ↗</a>}{(body.id === 'earth' || body.id === 'moon') && <a href="https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc" target="_blank" rel="noreferrer">NAIF/JPL DE440 GM ↗</a>}{body.isCatalogBody && <a href="https://www.minorplanetcenter.net/iau/MPCORB.html" target="_blank" rel="noreferrer">Minor Planet Center MPCORB ↗</a>}{profile.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label} ↗</a>)}</div><p className="fine-print">{t('profileSourceBoundary')}</p><a className="report-object-link" href={`https://github.com/dajiaohuang/solar/issues/new?template=data-error.yml&title=${encodeURIComponent(`Object report: ${bodyDisplayName(body, 'en')}`)}&body=${encodeURIComponent(`Object: ${body.id}\nDataset: ${catalog.datasetVersion}\nScene: ${encodeCurrentScene()}`)}`} target="_blank" rel="noreferrer">{t('reportThisObject')} ↗</a></section>}
    </>}
  </aside>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }
