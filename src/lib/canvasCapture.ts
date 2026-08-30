export const PREPARE_CANVAS_CAPTURE_EVENT = 'solar-atlas-prepare-canvas-capture'

export function prepareCanvasCapture(canvas: HTMLCanvasElement) {
  canvas.dispatchEvent(new Event(PREPARE_CANVAS_CAPTURE_EVENT))
}
