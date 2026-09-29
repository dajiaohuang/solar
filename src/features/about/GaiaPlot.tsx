import { useEffect, useRef } from 'react'
import capacity from '../../data/gaiaCapacity.json'
import { buildGaiaScreenPointIndex } from '../../lib/gaiaPointPicking'

// These are allocation policies, not measured total GPU/driver memory bounds.
const MAX_DISPLAY_ROWS = capacity.maxChartRows
const MAX_DRAWING_SIDE = 2048

export type GaiaDisplayBatch = { sequence: number; display: Float32Array }
type GaiaBatchQueue = { current: GaiaDisplayBatch[] }
export function GaiaPlot({ capacity, batchQueue, batchVersion, zoom, ariaLabel = 'Gaia ICRS tangent-plane star chart at J2016.0', onUploaded, onPresented, onError, onSelect }: {
  capacity: number; batchQueue: GaiaBatchQueue; batchVersion: number; zoom: number; ariaLabel?: string; onUploaded: (sequence: number) => void; onPresented: (rows: number) => void; onError: (error: string) => void; onSelect: (index: number) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<{ gl: WebGL2RenderingContext; buffer: WebGLBuffer; program: WebGLProgram; count: number; presentedCount: number; processed: number; drawnZoom: number;
    picking: { key: string; index: ReturnType<typeof buildGaiaScreenPointIndex> } | null;
    draw: (verifyGpu?: boolean, appended?: { first: number; count: number }) => boolean; dispose: () => void } | null>(null)
  const latest = useRef({ zoom, onUploaded, onPresented, onError }); latest.current = { zoom, onUploaded, onPresented, onError }
  useEffect(() => {
    if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > MAX_DISPLAY_ROWS) {
      latest.current.onError('Gaia display row capacity exceeds its allocation budget'); return
    }
    const element = canvas.current!, gl = element.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false })
    if (!gl) { latest.current.onError('WebGL 2 unavailable; no Gaia chart rendered.'); return }
    const shaders: WebGLShader[] = []
    let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null
    let texture: WebGLTexture | null = null, framebuffer: WebGLFramebuffer | null = null, observer: ResizeObserver | undefined
    let disposed = false, presentationFrame: number | undefined
    const dispose = () => {
      if (disposed) return
      disposed = true
      if (presentationFrame !== undefined) cancelAnimationFrame(presentationFrame)
      observer?.disconnect(); element.removeEventListener('webglcontextlost',lost)
      state.current = null
      if (buffer) gl.deleteBuffer(buffer)
      if (framebuffer) gl.deleteFramebuffer(framebuffer)
      if (texture) gl.deleteTexture(texture)
      if (program) gl.deleteProgram(program)
      shaders.forEach(s => gl.deleteShader(s))
    }
    const fail = (error: unknown) => { dispose(); latest.current.onError(String(error)) }
    const lost = (event: Event) => { event.preventDefault(); fail('Gaia graphics context lost; reload the data.') }
    try {
      const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array
      const maxSide = Math.min(MAX_DRAWING_SIDE, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
        gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, viewport[0], viewport[1])
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
      texture = gl.createTexture(); framebuffer = gl.createFramebuffer()
      if (!texture || !framebuffer) throw new Error('Gaia persistent render target allocation failed')
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const location = gl.getAttribLocation(program, 'point'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,3,gl.FLOAT,false,0,0)
      const zoomLocation = gl.getUniformLocation(program,'zoom'), densityLocation = gl.getUniformLocation(program,'density')
      let targetWidth = 0, targetHeight = 0
      const cancelPresentation = () => {
        if (presentationFrame === undefined) return
        cancelAnimationFrame(presentationFrame); presentationFrame = undefined
      }
      const present = () => {
        if (disposed) return false
        try {
          if (!framebuffer || targetWidth < 1 || targetHeight < 1) throw new Error('Gaia persistent render target is unavailable')
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer); gl.readBuffer(gl.COLOR_ATTACHMENT0)
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null)
          gl.blitFramebuffer(0,0,targetWidth,targetHeight,0,0,targetWidth,targetHeight,gl.COLOR_BUFFER_BIT,gl.NEAREST)
          gl.bindFramebuffer(gl.FRAMEBUFFER,null)
          if (gl.isContextLost()) throw new Error('Gaia graphics context is lost')
          if (gl.getError() !== gl.NO_ERROR) throw new Error('Gaia graphics composite failed')
          const current = state.current
          if (current && current.presentedCount !== current.count) {
            current.presentedCount = current.count
            latest.current.onPresented(current.presentedCount)
          }
          return true
        } catch (error) { fail(error); return false }
      }
      const schedulePresentation = () => {
        if (disposed || presentationFrame !== undefined) return
        presentationFrame = requestAnimationFrame(() => {
          presentationFrame = undefined
          present()
        })
      }
      const draw = (verifyGpu = true, appended?: { first: number; count: number }) => {
        if (disposed) return false
        try {
          const cssWidth = Math.max(1, element.clientWidth)
          const density = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.min(devicePixelRatio,2) : 1
          const width = Math.min(maxSide, Math.max(1,Math.round(cssWidth*density)))
          if (element.width !== width || element.height !== width) { element.width = width; element.height = width }
          const current = state.current
          if (!current || !texture || !framebuffer) throw new Error('Gaia persistent render target is unavailable')
          const resized = targetWidth !== width || targetHeight !== width
          const zoomChanged = current.drawnZoom !== Math.fround(latest.current.zoom)
          gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer)
          if (resized) {
            gl.bindTexture(gl.TEXTURE_2D,texture)
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,width,0,gl.RGBA,gl.UNSIGNED_BYTE,null)
            gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0)
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Gaia persistent render target is incomplete')
            targetWidth = width; targetHeight = width
          }
          gl.viewport(0,0,width,width)
          gl.clearColor(.025,.06,.09,1)
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA)
          gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER,buffer)
          gl.uniform1f(zoomLocation,latest.current.zoom); gl.uniform1f(densityLocation,width/cssWidth)
          if (resized || zoomChanged) {
            gl.clear(gl.COLOR_BUFFER_BIT)
            gl.drawArrays(gl.POINTS,0,current.count)
          } else if (appended && appended.count > 0) {
            gl.drawArrays(gl.POINTS,appended.first,appended.count)
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER,null)
          if (gl.isContextLost()) throw new Error('Gaia graphics context is lost')
          if (verifyGpu && gl.getError() !== gl.NO_ERROR) throw new Error('Gaia graphics draw failed; chunk was not acknowledged')
          if (resized || zoomChanged || !appended) {
            cancelPresentation()
            if (!present()) return false
            if (verifyGpu && gl.getError() !== gl.NO_ERROR) throw new Error('Gaia graphics composite failed; chunk was not acknowledged')
          } else schedulePresentation()
          current.drawnZoom = Math.fround(latest.current.zoom)
          return true
        } catch (error) { fail(error); return false }
      }
      state.current = { gl, buffer, program, count: 0, presentedCount: 0, processed: 0, drawnZoom: Math.fround(latest.current.zoom), picking: null, draw, dispose }
      observer = new ResizeObserver(() => draw(false)); observer.observe(element); element.addEventListener('webglcontextlost',lost); draw(false)
    } catch (error) { fail(error) }
    return dispose
  },[capacity])
  useEffect(() => {
    const batches = batchQueue.current
    const s = state.current; if (!s) return
    try {
      const first = s.count, sequences: number[] = []
      let count = 0
      // Validate the complete contiguous append before issuing GPU writes, then
      // draw it once if several worker messages landed in the same React commit.
      for (let index = s.processed; index < batches.length; index++) {
        const batch = batches[index], rows = batch.display.length/3
        if (!Number.isSafeInteger(batch.sequence) || batch.sequence < 1 || batch.display.length%3 ||
            !Number.isSafeInteger(rows) || rows < 1 || s.count+count+rows > capacity) {
          throw new Error('Gaia upload exceeds display capacity')
        }
        count += rows
        sequences.push(batch.sequence)
      }
      if (count === 0) return
      s.gl.bindBuffer(s.gl.ARRAY_BUFFER,s.buffer)
      for (; s.processed < batches.length; s.processed++) {
        const batch = batches[s.processed]
        s.gl.bufferSubData(s.gl.ARRAY_BUFFER,s.count*12,batch.display)
        if (s.gl.isContextLost()) throw new Error('Gaia graphics context is lost')
        s.count += batch.display.length/3
      }
      // Verify buffer uploads and one incremental draw before releasing credits;
      // the final composite remains scheduled on the next animation frame.
      if (!s.draw(true,{ first,count })) return
      for (const sequence of sequences) onUploaded(sequence)
    } catch (error) { s.dispose(); onError(String(error)) }
  },[batchVersion,batchQueue,capacity,onError,onUploaded])
  useEffect(() => { state.current?.draw(false) },[zoom])
  return <canvas ref={canvas} role="img" aria-label={ariaLabel} style={{ width:'100%', aspectRatio:'1', display:'block' }} onClick={event => {
    const batches = batchQueue.current
    const s = state.current, rect = event.currentTarget.getBoundingClientRect()
    if (!s || s.gl.isContextLost() || rect.width <= 0 || rect.height <= 0) return
    const clickX = event.clientX-rect.left, clickY = event.clientY-rect.top
    const key = `${rect.width}:${rect.height}:${s.drawnZoom}:${s.presentedCount}`
    if (s.picking?.key !== key) {
      let visibleRows = 0, visibleBatches = 0
      while (visibleRows < s.presentedCount && visibleBatches < s.processed) {
        visibleRows += batches[visibleBatches].display.length/3; visibleBatches++
      }
      if (visibleRows !== s.presentedCount) return
      s.picking = { key, index: buildGaiaScreenPointIndex(batches.slice(0, visibleBatches).map(batch => batch.display), rect.width, rect.height, s.drawnZoom, s.presentedCount) }
    }
    const nearest = s.picking.index.nearest(clickX, clickY, 12) // CSS pixels, independent of density.
    if (nearest >= 0) onSelect(nearest)
  }} />
}
