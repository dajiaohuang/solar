import type { CelestialBody } from '../types'

type Props = {
  body: CelestialBody | null
  distanceAU: number
  x: number
  y: number
  visible: boolean
}

export function BodyTooltip({ body, distanceAU, x, y, visible }: Props) {
  if (!visible || !body) {
    return null
  }

  return (
    <div
      className="body-tooltip"
      style={{
        position: 'fixed',
        left: x + 14,
        top: y - 10,
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      <div className="tooltip-name">{body.name}</div>
      <div className="tooltip-row">
        <span>类型</span>
        <span>
          {body.kind === 'star'
            ? '恒星'
            : body.kind === 'planet'
              ? '行星'
              : body.kind === 'moon'
                ? '卫星'
                : body.kind === 'dwarfPlanet'
                  ? '矮行星'
                  : '小行星'}
        </span>
      </div>
      <div className="tooltip-row">
        <span>距离</span>
        <span>{distanceAU.toFixed(4)} AU</span>
      </div>
      {body.orbit && (
        <>
          <div className="tooltip-row">
            <span>半长轴</span>
            <span>
              {body.orbit.model === 'planetaryApprox'
                ? body.orbit.base.semiMajorAxisAU.toFixed(3)
                : body.orbit.semiMajorAxisAU.toFixed(3)}{' '}
              AU
            </span>
          </div>
          <div className="tooltip-row">
            <span>离心率</span>
            <span>
              {(body.orbit.model === 'planetaryApprox'
                ? body.orbit.base.eccentricity
                : body.orbit.eccentricity
              ).toFixed(4)}
            </span>
          </div>
          <div className="tooltip-row">
            <span>倾角</span>
            <span>
              {(body.orbit.model === 'planetaryApprox'
                ? body.orbit.base.inclinationDeg
                : body.orbit.inclinationDeg
              ).toFixed(2)}
              °
            </span>
          </div>
        </>
      )}
      {body.absoluteMagnitude !== undefined && (
        <div className="tooltip-row">
          <span>绝对星等</span>
          <span>{body.absoluteMagnitude.toFixed(1)}</span>
        </div>
      )}
      {body.orbitClassName && (
        <div className="tooltip-row">
          <span>轨道分类</span>
          <span>{body.orbitClassName}</span>
        </div>
      )}
    </div>
  )
}
