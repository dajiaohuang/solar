import { useId } from 'react'
import type { projectLimbForDisplay, projectDirectionForLimbDisplay } from '../../engine/events/limbProjection'

export function LimbContour({ view, zh, sightline }: { view: ReturnType<typeof projectLimbForDisplay>; zh: boolean; sightline?: ReturnType<typeof projectDirectionForLimbDisplay> | null }) {
  const id = useId()
  const marker = sightline?.status === 'inside-plot' && sightline.point
    ? [160+(sightline.point[0]/view.halfExtent)*130, 160-(sightline.point[1]/view.halfExtent)*130] : null
  const markerDescription = !sightline ? '' : sightline.status === 'inside-plot'
    ? (zh ? '十字为输入视线方向，圆点为天体中心方向。十字大小不表示恒星直径。' : 'The cross marks the input sightline; the dot marks the body-center direction. Cross size does not represent stellar diameter.')
    : sightline.status === 'outside-plot'
      ? (zh ? '视线在当前图框外，未夹到边缘显示。' : 'The sightline lies outside this plot and is not clamped to its edge.')
      : sightline.status === 'behind-view'
        ? (zh ? '视线朝向天体中心方向的背面半球，未投影。' : 'The sightline points into the hemisphere opposite the body-center direction and is not projected.')
        : (zh ? '视线接近切平面投影奇点，未绘制标记。' : 'The sightline is near the tangent-plane projection horizon; no marker is drawn.')
  const path = view.points.map(([x, y], i) => `${i ? 'L' : 'M'}${160+(x/view.halfExtent)*130},${160-(y/view.halfExtent)*130}`).join(' ') + ' Z'
  return <figure className="limb-contour" style={{ margin: '1rem 0' }}>
    <svg viewBox="0 0 320 320" role="img" aria-labelledby={`${id}-title ${id}-description`} style={{ display: 'block', width: '100%', maxWidth: 420, margin: 'auto' }}>
      <title id={`${id}-title`}>{zh ? '观测者视角的椭球轮廓' : 'Ellipsoid limb from the observer'}</title>
      <desc id={`${id}-description`}>{zh ? '原点为天体中心方向，横纵轴等比例；图中轮廓由原始生成向量采样并透视投影。' : 'The origin is the body-center direction, with equal horizontal and vertical scale. The contour samples and perspective-projects the original limb generators.'} {markerDescription}</desc>
      <rect x="30" y="30" width="260" height="260" fill="none" stroke="currentColor" opacity="0.25" />
      <path d="M30 160H290 M160 30V290" stroke="currentColor" opacity="0.3" fill="none" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="160" cy="160" r="2" fill="currentColor" />
      {marker && <path d={`M${marker[0]-5} ${marker[1]}h10 M${marker[0]} ${marker[1]-5}v10`} stroke="currentColor" strokeWidth="2" fill="none" />}
      <text x="160" y="18" textAnchor="middle" fill="currentColor" fontSize="11">{view.poleFallback ? '+Y' : zh ? '北 +Y' : 'North +Y'}</text>
      <text x="288" y="308" textAnchor="end" fill="currentColor" fontSize="11">{view.poleFallback ? '+X' : zh ? '东 +X' : 'East +X'}</text>
    </svg>
    <figcaption>{zh ? '切平面透视坐标，无量纲；横纵轴范围均为' : 'Dimensionless perspective tangent-plane coordinates; both axis ranges are'} ±{view.halfExtent.toPrecision(5)}.
      {' '}{view.segments}{zh ? ' 段采样，仅供显示；未认证插值误差，不表示照明或事件概率。' : ' sampled segments for display only; interpolation error is not certified. This does not show illumination or event probability.'}
      {view.poleFallback && (zh ? ' 极点附近东西方向无定义，使用导出文件中的备用基。' : ' East is undefined near a pole; the exported fallback basis is used.')}
      {sightline && <> {markerDescription} {zh ? '图上位置不用于判定相交；几何判定单独列出。' : 'Plot position is not used to determine intersection; geometry is reported separately.'}</>}
    </figcaption>
  </figure>
}
