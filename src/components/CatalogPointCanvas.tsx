import { useEffect, useMemo, useRef } from 'react'
import type { AsteroidRecord } from '../types'

type Props = {
  records: AsteroidRecord[]
  positions: Float32Array
  viewRadiusAU: number
  opacity?: number
  ariaLabel?: string
}

const CLASS_COLORS: Record<string, [number, number, number]> = {
  MBA: [0.45, 0.65, 0.79], APO: [1, 0.45, 0.37], ATE: [1, 0.68, 0.33],
  AMO: [0.91, 0.56, 0.85], ATI: [0.96, 0.83, 0.37], MCR: [0.94, 0.56, 0.42], HUN: [0.44, 0.82, 0.66],
  HIL: [0.62, 0.55, 1], JTA: [0.79, 0.65, 0.42], TNO: [0.56, 0.68, 1],
}

function shader(gl: WebGLRenderingContext, type: number, source: string) {
  const result = gl.createShader(type)
  if (!result) throw new Error('Unable to create catalog shader')
  gl.shaderSource(result, source)
  gl.compileShader(result)
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result) ?? 'Catalog shader compilation failed')
  return result
}

function program(gl: WebGLRenderingContext) {
  const result = gl.createProgram()
  if (!result) throw new Error('Unable to create catalog program')
  const vertex = shader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    attribute vec4 a_color;
    attribute float a_size;
    uniform float u_radius;
    uniform float u_aspect;
    uniform float u_pixel_ratio;
    varying vec4 v_color;
    void main() {
      gl_Position = vec4(a_position.x / (u_radius * u_aspect), a_position.y / u_radius, 0.0, 1.0);
      gl_PointSize = a_size * u_pixel_ratio;
      v_color = a_color;
    }
  `)
  const fragment = shader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec4 v_color;
    void main() {
      vec2 delta = gl_PointCoord - vec2(0.5);
      if (dot(delta, delta) > 0.25) discard;
      gl_FragColor = v_color;
    }
  `)
  gl.attachShader(result, vertex); gl.attachShader(result, fragment); gl.linkProgram(result)
  gl.deleteShader(vertex); gl.deleteShader(fragment)
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) ?? 'Catalog program link failed')
  return result
}

export function CatalogPointCanvas({ records, positions, viewRadiusAU, opacity = 0.82, ariaLabel = 'GPU small-body catalog view' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const appearance = useMemo(() => {
    const colors = new Float32Array(records.length * 4)
    const sizes = new Float32Array(records.length)
    records.forEach((record, index) => {
      const color = record.isPha ? [1, 0.35, 0.3] : record.isNeo ? [1, 0.62, 0.5] : CLASS_COLORS[record.orbitClassCode] ?? [0.62, 0.7, 0.76]
      colors.set([color[0], color[1], color[2], opacity], index * 4)
      sizes[index] = record.isPha ? 3.2 : record.isNeo ? 2.5 : 1.7
    })
    return { colors, sizes }
  }, [opacity, records])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || positions.length !== records.length * 2) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) return
    const pointProgram = program(gl)
    const positionBuffer = gl.createBuffer(), colorBuffer = gl.createBuffer(), sizeBuffer = gl.createBuffer()
    if (!positionBuffer || !colorBuffer || !sizeBuffer) throw new Error('Unable to allocate catalog GPU buffers')

    const draw = () => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio, 2)
      const width = Math.max(1, Math.round(bounds.width * ratio)), height = Math.max(1, Math.round(bounds.height * ratio))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      gl.viewport(0, 0, width, height)
      gl.clearColor(0.018, 0.028, 0.043, 1); gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.useProgram(pointProgram)
      const bind = (buffer: WebGLBuffer, name: string, size: number, data: BufferSource) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
        const location = gl.getAttribLocation(pointProgram, name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
      }
      bind(positionBuffer, 'a_position', 2, positions as Float32Array<ArrayBuffer>)
      bind(colorBuffer, 'a_color', 4, appearance.colors)
      bind(sizeBuffer, 'a_size', 1, appearance.sizes)
      gl.uniform1f(gl.getUniformLocation(pointProgram, 'u_radius'), Math.max(viewRadiusAU, 0.001))
      gl.uniform1f(gl.getUniformLocation(pointProgram, 'u_aspect'), width / Math.max(height, 1))
      gl.uniform1f(gl.getUniformLocation(pointProgram, 'u_pixel_ratio'), ratio)
      gl.drawArrays(gl.POINTS, 0, records.length)
    }
    draw()
    const observer = new ResizeObserver(draw); observer.observe(canvas)
    return () => {
      observer.disconnect()
      gl.deleteBuffer(positionBuffer); gl.deleteBuffer(colorBuffer); gl.deleteBuffer(sizeBuffer); gl.deleteProgram(pointProgram)
    }
  }, [appearance, positions, records.length, viewRadiusAU])

  return <canvas ref={canvasRef} className="viz-canvas catalog-point-canvas" role="img" aria-label={`${ariaLabel}: ${records.length.toLocaleString()}`} />
}
