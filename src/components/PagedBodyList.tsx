import { useState, type ReactNode } from 'react'
import { useI18n } from '../i18n/context'
import type { CelestialBody } from '../types'

/** Bound DOM cost without discarding selected identities or their positions. */
export function PagedBodyList({ bodies, children, className, label, as: List = 'div' }: {
  bodies: CelestialBody[]
  children: (body: CelestialBody) => ReactNode
  className?: string
  label?: string
  as?: 'div' | 'ul'
}) {
  const { t } = useI18n()
  const [page, setPage] = useState(0)
  const size = 80
  const last = Math.max(0, Math.ceil(bodies.length / size) - 1)
  const active = Math.min(page, last)
  return <>
    <List className={className} aria-label={label} data-total-count={bodies.length}>
      {bodies.slice(active * size, (active + 1) * size).map(children)}
    </List>
    {last > 0 && <div className="inline-actions body-list-pagination">
      <button disabled={active === 0} onClick={() => setPage(active - 1)}>{t('previous')}</button>
      <span>{active * size + 1}–{Math.min((active + 1) * size, bodies.length)} / {bodies.length}</span>
      <button disabled={active === last} onClick={() => setPage(active + 1)}>{t('next')}</button>
    </div>}
  </>
}
