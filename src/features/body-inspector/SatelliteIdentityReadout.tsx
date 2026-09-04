import { satelliteIdentity } from '../../data/satelliteIdentities'
import { useI18n } from '../../i18n/context'
import type { CelestialBody } from '../../types'

export function SatelliteIdentityReadout({ body, sources = false }: { body: CelestialBody; sources?: boolean }) {
  const { t } = useI18n()
  const identity = satelliteIdentity(body)
  if (!identity) return null
  const status = identity.identityStatus === 'matched' ? t('satelliteIdentityMatched')
    : identity.identityStatus === 'source-identified-not-in-discovery-snapshot' ? t('satelliteIdentitySourceOnly')
      : t('satelliteIdentityUnresolved')
  if (sources) return <div className="source-list">
    <a href="https://ssd.jpl.nasa.gov/sats/discovery.html" target="_blank" rel="noreferrer">JPL · {t('satelliteIdentityCatalog')} ↗</a>
    <a href="https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/" target="_blank" rel="noreferrer">JPL · SPK {identity.sourceEphemerides.join(', ')} ↗</a>
    <a href="https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/naif_ids.html" target="_blank" rel="noreferrer">NAIF · {t('satelliteIdentityCatalog')} ↗</a>
  </div>
  return <p className="fine-print" data-testid="satellite-identity">{t('satelliteIdentityCatalog')}: {identity.name}
    {identity.naifId !== undefined ? ` · NAIF ${identity.naifId}` : ''} · {status}. {t('satelliteIdentityBoundary')}</p>
}
