import { simulationClock } from '../engine/clock/SimulationClock'
import { catalogStore } from '../state/catalog-store'
import { simulationStore } from '../state/simulation-store'
import { BUILD_INFO } from './buildInfo'
import { encodeCurrentScene } from './shareScene'

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'))
}

export async function exportAnnotatedScenePng(language: 'en' | 'zh') {
  const source = document.querySelector<HTMLCanvasElement>('.frames-grid .frame-view canvas')
  if (!source) throw new Error(language === 'zh' ? '当前工作区没有可导出的场景画布。' : 'The current workspace has no scene canvas to export.')
  const width = 1600
  const headerHeight = 112
  const footerHeight = 122
  const contentHeight = 900
  const output = document.createElement('canvas')
  output.width = width
  output.height = headerHeight + contentHeight + footerHeight
  const context = output.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable')
  context.fillStyle = '#05080c'
  context.fillRect(0, 0, output.width, output.height)
  context.fillStyle = '#dbe5e8'
  context.font = '300 42px system-ui, sans-serif'
  context.fillText(language === 'zh' ? '太阳系图谱' : 'SOLAR ATLAS', 54, 62)
  context.fillStyle = '#62d0b5'
  context.font = '16px ui-monospace, monospace'
  context.fillText(language === 'zh' ? '可复现场景导出' : 'REPRODUCIBLE SCENE EXPORT', 56, 91)

  const scale = Math.min(width / source.width, contentHeight / source.height)
  const drawWidth = source.width * scale
  const drawHeight = source.height * scale
  const drawX = (width - drawWidth) / 2
  const drawY = headerHeight + (contentHeight - drawHeight) / 2
  context.drawImage(source, drawX, drawY, drawWidth, drawHeight)

  const simulation = simulationStore.getState()
  const catalog = catalogStore.getState()
  const url = encodeCurrentScene()
  context.fillStyle = '#0c1218'
  context.fillRect(0, headerHeight + contentHeight, width, footerHeight)
  context.fillStyle = '#dbe5e8'
  context.font = '17px ui-monospace, monospace'
  context.fillText(`JD ${simulationClock.getJulianDay().toFixed(5)} · ${simulation.referenceId} · ${simulation.viewMode.toUpperCase()} · ${catalog.datasetVersion}`, 54, headerHeight + contentHeight + 38)
  context.fillStyle = '#7f929d'
  context.font = '14px ui-monospace, monospace'
  context.fillText(`Solar Atlas v${BUILD_INFO.version} · ${BUILD_INFO.commitSha.slice(0, 12)} · ${BUILD_INFO.buildTime}`, 54, headerHeight + contentHeight + 69)
  context.fillText(url.length > 180 ? `${url.slice(0, 177)}…` : url, 54, headerHeight + contentHeight + 96)

  const blob = await canvasBlob(output)
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = `solar-atlas-${new Date().toISOString().slice(0, 10)}.png`
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}
