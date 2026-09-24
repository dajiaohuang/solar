import { useEffect, useRef } from 'react'
import capacity from '../../data/gaiaCapacity.json'
import { buildGaiaScreenPointIndex } from '../../lib/gaiaPointPicking'

// These are allocation policies, not measured total GPU/driver memory bounds.
const MAX_DISPLAY_ROWS = capacity.maxChartRows
const MAX_DRAWING_SIDE = 2048

export type GaiaDisplayBatch = { sequence: number; display: Float32Array }
export function GaiaPlot({ capacity, batches, zoom, onUploaded, onError, onSelect }: {
  capacity: number; batches: GaiaDisplayBatch[]; zoom: number; onUploaded: (sequence: number) => void; onError: (error: string) => void; onSelect: (index: number) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<{ gl: WebGL2RenderingContext; buffer: WebGLBuffer; program: WebGLProgram; count: number; processed: number; drawnZoom: number;
    picking: { key: string; index: ReturnType<typeof buildGaiaScreenPointIndex> } | null; draw: () => boolean; dispose: () => void } | null>(null)
  const latest = useRef({ zoom, onUploaded, onError }); latest.current = { zoom, onUploaded, onError }
  useEffect(() => {
    if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > MAX_DISPLAY_ROWS) {
      latest.current.onError('Gaia display row capacity exceeds its allocation budget'); return
    }
    const element = canvas.current!, gl = element.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false })
    if (!gl) { latest.current.onError('WebGL 2 unavailable; no Gaia chart rendered.'); return }
    const shaders: WebGLShader[] = []
    let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null, observer: ResizeObserver | undefined
    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      observer?.disconnect(); element.removeEventListener('webglcontextlost',lost)
      state.current = null
      if (buffer) gl.deleteBuffer(buffer)
      if (program) gl.deleteProgram(program)
      shaders.forEach(s => gl.deleteShader(s))
    }
    const fail = (error: unknown) => { dispose(); latest.current.onError(String(error)) }
    const lost = (event: Event) => { event.preventDefault(); fail('Gaia graphics context lost; reload the data.') }
    try {
      const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array
      const maxSide = Math.min(MAX_DRAWING_SIDE, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, viewport[0], viewport[1])
      if (!Number.isSafeInteger(maxSide) || maxSide < 1) throw new Error('Gaia graphics drawing limits are unavailable')
      const shader = (type: number, source: string) => {
        const s = gl.createShader(type)
        if (!s) throw new Error('Gaia shader allocation failed')
        shaders.push(s); gl.shaderSource(s, source); gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Gaia shader failed')
        return s
      }
      program = gl.createProgram()
      if (!program) throw new Error('Gaia program allocation failed')
      gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
        in vec3 point; uniform float zoom; uniform float density;
        void main(){gl_Position=vec4(point.xy*zoom,0.,1.);gl_PointSize=clamp(9.-point.z*.35,2.,9.)*density;}`))
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float; out vec4 color;
        void main(){float r=length(gl_PointCoord-vec2(.5))*2.; if(r>1.)discard;color=vec4(.89,.95,1.,1.-smoothstep(.4,1.,r));}`))
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Gaia program failed to link')
      gl.useProgram(program); buffer = gl.createBuffer()
      if (!buffer) throw new Error('Gaia point buffer allocation failed')
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, Math.max(1,capacity)*12, gl.DYNAMIC_DRAW)
      if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw new Error('Gaia point buffer allocation exceeds available graphics resources')
      const location = gl.getAttribLocation(program, 'point'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,3,gl.FLOAT,false,0,0)
      const zoomLocation = gl.getUniformLocation(program,'zoom'), densityLocation = gl.getUniformLocation(program,'density')
      const draw = () => {
        if (disposed) return false
        try {
          const cssWidth = Math.max(1, element.clientWidth)
          const density = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.min(devicePixelRatio,2) : 1
          const width = Math.min(maxSide, Math.max(1,Math.round(cssWidth*density)))
          if (element.width !== width || element.height !== width) { element.width = width; element.height = width }
          gl.viewport(0,0,width,width); gl.clearColor(.025,.06,.09,1); gl.clear(gl.COLOR_BUFFER_BIT)
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA)
          gl.uniform1f(zoomLocation,latest.current.zoom); gl.uniform1f(densityLocation,width/cssWidth); gl.drawArrays(gl.POINTS,0,state.current?.count ?? 0)
          if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw new Error('Gaia graphics draw failed; chunk was not acknowledged')
          if (state.current) state.current.drawnZoom = Math.fround(latest.current.zoom)
          return true
        } catch (error) { fail(error); return false }
      }
      state.current = { gl, buffer, program, count: 0, processed: 0, drawnZoom: Math.fround(latest.current.zoom), picking: null, draw, dispose }
      observer = new ResizeObserver(draw); observer.observe(element); element.addEventListener('webglcontextlost',lost); draw()
    } catch (error) { fail(error) }
    return dispose
  },[capacity])
  useEffect(() => {
    const s = state.current; if (!s) return
    try {
      for (; s.processed < batches.length; s.processed++) {
        const batch = batches[s.processed]
        if (batch.display.length%3 || s.count+batch.display.length/3 > capacity) throw new Error('Gaia upload exceeds display capacity')
        s.gl.bindBuffer(s.gl.ARRAY_BUFFER,s.buffer); s.gl.bufferSubData(s.gl.ARRAY_BUFFER,s.count*12,batch.display)
        if (s.gl.isContextLost() || s.gl.getError() !== s.gl.NO_ERROR) throw new Error('Gaia graphics upload failed; chunk was not acknowledged')
        s.count += batch.display.length/3
        if (!s.draw()) return
        onUploaded(batch.sequence)
      }
    } catch (error) { s.dispose(); onError(String(error)) }
  },[batches,capacity,onError,onUploaded])
  useEffect(() => { state.current?.draw() },[zoom])
  return <canvas ref={canvas} role="img" aria-label="Gaia ICRS tangent-plane star chart at J2016.0" style={{ width:'100%', aspectRatio:'1', display:'block' }} onClick={event => {
    const s = state.current, rect = event.currentTarget.getBoundingClientRect()
    if (!s || s.gl.isContextLost() || rect.width <= 0 || rect.height <= 0) return
    const clickX = event.clientX-rect.left, clickY = event.clientY-rect.top
    const key = `${rect.width}:${rect.height}:${s.drawnZoom}:${s.count}`
    if (s.picking?.key !== key) {
      s.picking = { key, index: buildGaiaScreenPointIndex(batches.slice(0, s.processed).map(batch => batch.display), rect.width, rect.height, s.drawnZoom, s.count) }
    }
    const nearest = s.picking.index.nearest(clickX, clickY, 12) // CSS pixels, independent of density.
    if (nearest >= 0) onSelect(nearest)
  }} />
}
