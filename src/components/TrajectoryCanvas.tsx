import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PREPARE_CANVAS_CAPTURE_EVENT } from '../lib/canvasCapture'
import { SVG_PADDING, createProjection, projectPoint, unprojectPoint } from '../lib/viewProjection'
import type { LagrangePoint } from '../lib/lagrange'
import type { AsteroidRecord, CelestialBody, RenderedBodyPosition, TrajectorySample, Vector2 } from '../types'
import type { CurrentPositions } from '../lib/currentPositions'
import { bodyDisplayName } from '../lib/bodyNames'
import { buildGeometry, type Geometry, type OrbitEllipse } from '../lib/trajectoryGeometry2d'


type Props = {
  language?: 'zh' | 'en'
  referenceBody: CelestialBody
  trajectories: TrajectorySample[]
  currentPositions: CurrentPositions
  viewRadiusAU: number
  viewOffsetAU: { x: number; y: number }
  showEcliptic?: boolean
  showOrbits?: boolean
  orbitEllipses?: OrbitEllipse[]
  onReferenceChange?: (bodyId: string) => void
  onHover?: (body: CelestialBody | null, distance: number, x: number, y: number) => void
  lagrangePoints?: { body: CelestialBody; points: LagrangePoint[] }[]
  influenceCircles?: {
    body: CelestialBody
    position: Vector2
    radiusAU: number
    definition: 'hill' | 'laplace-soi'
  }[]
  planetOpacity?: number
  asteroidOpacity?: number
  moonOpacity?: number
  ariaLabel?: string
  emptyLabel?: string
  webglUnavailableLabel?: string
  influenceLabels?: { hill: string; soi: string }
  catalogRecords?: AsteroidRecord[]
  catalogPositions?: Float32Array
  catalogDrawCount?: number
  catalogOrigin?: Vector2
  pixelRatioLimit?: number
  continuous?: boolean
  onFrameDuration?: (durationMs: number) => void
}


type GlResources = {
  gl: WebGLRenderingContext
  lineProgram: WebGLProgram
  pointProgram: WebGLProgram
  linePositionBuffer: WebGLBuffer
  lineColorBuffer: WebGLBuffer
  pointPositionBuffer: WebGLBuffer
  pointColorBuffer: WebGLBuffer
  pointSizeBuffer: WebGLBuffer
}

const CANVAS_SIZE = 880
const MAJOR_LABEL_LIMIT = 18
const ASTEROID_LABEL_LIMIT = 6
const EMPTY_CATALOG_RECORDS: AsteroidRecord[] = []
const EMPTY_CATALOG_POSITIONS = new Float32Array()
const HELIOCENTRIC_ORIGIN = { x: 0, y: 0 }

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: CANVAS_SIZE, height: CANVAS_SIZE })

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const update = () => {
      const width = Math.max(Math.round(element.clientWidth), 1)
      const height = Math.max(Math.round(element.clientHeight), 1)
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      )
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return [ref, size] as const
}


function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error('Failed to create shader')
  }

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown shader error'
    gl.deleteShader(shader)
    throw new Error(message)
  }

  return shader
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {
  const program = gl.createProgram()
  if (!program) {
    throw new Error('Failed to create WebGL program')
  }

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Unknown link error'
    gl.deleteProgram(program)
    throw new Error(message)
  }

  return program
}

function createResources(gl: WebGLRenderingContext): GlResources {
  const lineProgram = createProgram(
    gl,
    `
      attribute vec2 aPosition;
      attribute vec4 aColor;
      varying vec4 vColor;

      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vColor = aColor;
      }
    `,
    `
      precision mediump float;
      varying vec4 vColor;

      void main() {
        gl_FragColor = vColor;
      }
    `,
  )

  const pointProgram = createProgram(
    gl,
    `
      attribute vec2 aPosition;
      attribute vec4 aColor;
      attribute float aPointSize;
      uniform float uPixelRatio;
      varying vec4 vColor;

      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        gl_PointSize = aPointSize * uPixelRatio;
        vColor = aColor;
      }
    `,
    `
      precision mediump float;
      varying vec4 vColor;

      void main() {
        vec2 centered = gl_PointCoord * 2.0 - 1.0;
        if (dot(centered, centered) > 1.0) {
          discard;
        }

        gl_FragColor = vColor;
      }
    `,
  )

  const linePositionBuffer = gl.createBuffer()
  const lineColorBuffer = gl.createBuffer()
  const pointPositionBuffer = gl.createBuffer()
  const pointColorBuffer = gl.createBuffer()
  const pointSizeBuffer = gl.createBuffer()

  if (
    !linePositionBuffer ||
    !lineColorBuffer ||
    !pointPositionBuffer ||
    !pointColorBuffer ||
    !pointSizeBuffer
  ) {
    throw new Error('Failed to create WebGL buffers')
  }

  return {
    gl,
    lineProgram,
    pointProgram,
    linePositionBuffer,
    lineColorBuffer,
    pointPositionBuffer,
    pointColorBuffer,
    pointSizeBuffer,
  }
}

function resetVertexAttributes(gl: WebGLRenderingContext) {
  const maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number

  for (let index = 0; index < maxAttributes; index += 1) {
    gl.disableVertexAttribArray(index)
  }
}


function drawLines(resources: GlResources, geometry: Geometry, upload = true) {
  const { gl, lineProgram, linePositionBuffer, lineColorBuffer } = resources
  if (!geometry.linePositions.length) {
    return
  }

  resetVertexAttributes(gl)
  gl.useProgram(lineProgram)

  const positionLocation = gl.getAttribLocation(lineProgram, 'aPosition')
  const colorLocation = gl.getAttribLocation(lineProgram, 'aColor')

  gl.bindBuffer(gl.ARRAY_BUFFER, linePositionBuffer)
  if (upload) gl.bufferData(gl.ARRAY_BUFFER, geometry.linePositions, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ARRAY_BUFFER, lineColorBuffer)
  if (upload) gl.bufferData(gl.ARRAY_BUFFER, geometry.lineColors, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(colorLocation)
  gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0)

  gl.drawArrays(gl.LINES, 0, geometry.linePositions.length / 2)
}

function drawPoints(resources: GlResources, geometry: Geometry, pixelRatio: number, upload = true) {
  const { gl, pointProgram, pointPositionBuffer, pointColorBuffer, pointSizeBuffer } = resources
  if (!geometry.pointPositions.length) {
    return
  }

  resetVertexAttributes(gl)
  gl.useProgram(pointProgram)

  const positionLocation = gl.getAttribLocation(pointProgram, 'aPosition')
  const colorLocation = gl.getAttribLocation(pointProgram, 'aColor')
  const sizeLocation = gl.getAttribLocation(pointProgram, 'aPointSize')
  const pixelRatioLocation = gl.getUniformLocation(pointProgram, 'uPixelRatio')

  gl.uniform1f(pixelRatioLocation, pixelRatio)

  gl.bindBuffer(gl.ARRAY_BUFFER, pointPositionBuffer)
  if (upload) gl.bufferData(gl.ARRAY_BUFFER, geometry.pointPositions, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ARRAY_BUFFER, pointColorBuffer)
  if (upload) gl.bufferData(gl.ARRAY_BUFFER, geometry.pointColors, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(colorLocation)
  gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ARRAY_BUFFER, pointSizeBuffer)
  if (upload) gl.bufferData(gl.ARRAY_BUFFER, geometry.pointSizes, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(sizeLocation)
  gl.vertexAttribPointer(sizeLocation, 1, gl.FLOAT, false, 0, 0)

  gl.drawArrays(gl.POINTS, 0, geometry.pointPositions.length / 2)
}

export function TrajectoryCanvas({
  language = 'en',
  referenceBody,
  trajectories,
  currentPositions,
  viewRadiusAU,
  viewOffsetAU,
  showEcliptic = true,
  showOrbits,
  orbitEllipses,
  onReferenceChange,
  onHover,
  lagrangePoints,
  influenceCircles,
  planetOpacity = 1,
  asteroidOpacity = 1,
  moonOpacity = 1,
  ariaLabel = 'Interactive two-dimensional Solar System trajectory view',
  emptyLabel = 'Select at least one celestial object to display.',
  webglUnavailableLabel = 'WebGL acceleration is unavailable in this browser.',
  influenceLabels = { hill: 'Hill Sphere', soi: 'Laplace SOI' },
  catalogRecords = EMPTY_CATALOG_RECORDS,
  catalogPositions = EMPTY_CATALOG_POSITIONS,
  catalogDrawCount = 0,
  catalogOrigin = HELIOCENTRIC_ORIGIN,
  pixelRatioLimit = 1.75,
  continuous = false,
  onFrameDuration,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const resourcesRef = useRef<GlResources | null>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const lastTouchTapRef = useRef<{ bodyId: string; timestamp: number } | null>(null)
  const touchGestureRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null)
  const activeTouchPointersRef = useRef(new Set<number>())
  const [containerRef, size] = useElementSize<HTMLDivElement>()
  const [webglUnavailable, setWebglUnavailable] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onLost = (event: Event) => { event.preventDefault(); setWebglUnavailable(true) }
    const onRestored = () => { resourcesRef.current = null; setWebglUnavailable(false) }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    return () => { canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored) }
  }, [])

  const projection = useMemo(
    () =>
      createProjection(
        viewRadiusAU,
        Math.max(size.width, 1),
        Math.max(size.height, 1),
        (SVG_PADDING / CANVAS_SIZE) * Math.max(size.width, 1),
        viewOffsetAU,
      ),
    [size.height, size.width, viewOffsetAU, viewRadiusAU],
  )

  const labels = useMemo(() => {
    const majorBodies: RenderedBodyPosition[] = [], asteroidBodies: RenderedBodyPosition[] = []
    for (let index = 0; index < currentPositions.length; index++) {
      const asteroid = currentPositions.bodyAt(index).kind === 'asteroid'
      if (asteroid && asteroidBodies.length < ASTEROID_LABEL_LIMIT) asteroidBodies.push(currentPositions.rowAt(index))
      if (!asteroid && majorBodies.length < MAJOR_LABEL_LIMIT) majorBodies.push(currentPositions.rowAt(index))
      if (majorBodies.length === MAJOR_LABEL_LIMIT && asteroidBodies.length === ASTEROID_LABEL_LIMIT) break
    }
    return [...majorBodies, ...asteroidBodies]
  }, [currentPositions])

  const geometry = useMemo(
    () =>
      buildGeometry(
        projection,
        referenceBody,
        trajectories,
        currentPositions,
        showEcliptic,
        showOrbits ?? false,
        orbitEllipses ?? [],
        planetOpacity,
        asteroidOpacity,
        moonOpacity,
        catalogRecords,
        catalogPositions,
        catalogDrawCount,
        catalogOrigin,
      ),
    [asteroidOpacity, catalogDrawCount, catalogOrigin, catalogPositions, catalogRecords, currentPositions, moonOpacity, orbitEllipses, planetOpacity, projection, referenceBody, showEcliptic, showOrbits, trajectories],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const width = Math.max(size.width, 1)
    const height = Math.max(size.height, 1)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, pixelRatioLimit)

    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    let resources = resourcesRef.current
    if (!resources) {
      const gl = canvas.getContext('webgl', { alpha: true, antialias: true })
      if (!gl) {
        setWebglUnavailable(true)
        return
      }

      resources = createResources(gl)
      resourcesRef.current = resources
    }

    const drawFrame = (upload = false) => {
      const { gl } = resources
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

      drawLines(resources, geometry, upload)
      drawPoints(resources, geometry, pixelRatio, upload)
    }
    const redraw = () => drawFrame()
    canvas.addEventListener(PREPARE_CANVAS_CAPTURE_EVENT, redraw)
    drawFrame(true)
    drawRef.current = redraw
    return () => { drawRef.current = null; canvas.removeEventListener(PREPARE_CANVAS_CAPTURE_EVENT, redraw) }
  }, [geometry, pixelRatioLimit, size.height, size.width, webglUnavailable])

  useEffect(() => {
    if (!continuous || webglUnavailable) return
    let handle = 0, previous: number | null = null
    const frame = (timestamp: number) => {
      if (document.hidden || !drawRef.current || resourcesRef.current?.gl.isContextLost()) previous = null
      else {
        drawRef.current()
        if (previous !== null) onFrameDuration?.(timestamp - previous)
        previous = timestamp
      }
      handle = window.requestAnimationFrame(frame)
    }
    handle = window.requestAnimationFrame(frame)
    return () => window.cancelAnimationFrame(handle)
  }, [continuous, onFrameDuration, webglUnavailable])

  useEffect(() => {
    return () => {
      const resources = resourcesRef.current
      if (!resources) {
        return
      }

      const { gl } = resources
      gl.deleteBuffer(resources.linePositionBuffer)
      gl.deleteBuffer(resources.lineColorBuffer)
      gl.deleteBuffer(resources.pointPositionBuffer)
      gl.deleteBuffer(resources.pointColorBuffer)
      gl.deleteBuffer(resources.pointSizeBuffer)
      gl.deleteProgram(resources.lineProgram)
      gl.deleteProgram(resources.pointProgram)
      resourcesRef.current = null
    }
  }, [])

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onReferenceChange) {
        return
      }

      const rect = event.currentTarget.getBoundingClientRect()
      const clickPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }

      const worldPoint = unprojectPoint(clickPoint, projection)
      const thresholdAU = viewRadiusAU * 0.06

      let nearestBody: string | null = null
      let nearestDistance = Number.POSITIVE_INFINITY

      for (let index = 0; index < currentPositions.length; index++) {
        const dx = currentPositions.coordinateAt(index, 0) - worldPoint.x
        const dy = currentPositions.coordinateAt(index, 1) - worldPoint.y
        const dist = Math.hypot(dx, dy)

        if (dist < thresholdAU && dist < nearestDistance) {
          nearestDistance = dist
          nearestBody = currentPositions.bodyAt(index).id
        }
      }

      if (nearestBody) {
        onReferenceChange(nearestBody)
      }
    },
    [currentPositions, onReferenceChange, projection, viewRadiusAU],
  )

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onHover) {
        return
      }

      const rect = event.currentTarget.getBoundingClientRect()
      const clickPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }

      const worldPoint = unprojectPoint(clickPoint, projection)
      const thresholdAU = viewRadiusAU * 0.06

      let nearestIndex = -1
      let nearestDistance = Number.POSITIVE_INFINITY

      for (let index = 0; index < currentPositions.length; index++) {
        const dx = currentPositions.coordinateAt(index, 0) - worldPoint.x
        const dy = currentPositions.coordinateAt(index, 1) - worldPoint.y
        const dist = Math.hypot(dx, dy)

        if (dist < thresholdAU && dist < nearestDistance) {
          nearestDistance = dist
          nearestIndex = index
        }
      }

      if (nearestIndex >= 0) {
        onHover(currentPositions.bodyAt(nearestIndex), currentPositions.distanceAt(nearestIndex), event.clientX, event.clientY)
      } else {
        onHover(null, 0, 0, 0)
      }
    },
    [currentPositions, onHover, projection, viewRadiusAU],
  )

  const handleTouchTap = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const worldPoint = unprojectPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top }, projection)
    const thresholdAU = viewRadiusAU * 0.1
    let nearestIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < currentPositions.length; index++) {
      const distance = Math.hypot(currentPositions.coordinateAt(index, 0) - worldPoint.x, currentPositions.coordinateAt(index, 1) - worldPoint.y)
      if (distance < thresholdAU && distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    }
    if (nearestIndex < 0) {
      lastTouchTapRef.current = null
      return
    }
    const nearestItem = currentPositions.rowAt(nearestIndex)
    onHover?.(nearestItem.body, nearestItem.distance, event.clientX, event.clientY)
    const now = performance.now()
    const previous = lastTouchTapRef.current
    if (previous?.bodyId === nearestItem.body.id && now - previous.timestamp < 420) {
      onReferenceChange?.(nearestItem.body.id)
      lastTouchTapRef.current = null
    } else {
      lastTouchTapRef.current = { bodyId: nearestItem.body.id, timestamp: now }
    }
  }, [currentPositions, onHover, onReferenceChange, projection, viewRadiusAU])

  const handleTouchStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return
    activeTouchPointersRef.current.add(event.pointerId)
    if (activeTouchPointersRef.current.size !== 1) {
      touchGestureRef.current = null
      lastTouchTapRef.current = null
      return
    }
    touchGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
  }, [])

  const handleTouchMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return
    const gesture = touchGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 12) {
      gesture.moved = true
      lastTouchTapRef.current = null
    }
  }, [])

  const handleTouchEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return
    activeTouchPointersRef.current.delete(event.pointerId)
    const gesture = touchGestureRef.current
    touchGestureRef.current = null
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return
    handleTouchTap(event)
  }, [handleTouchTap])

  const handleTouchCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return
    activeTouchPointersRef.current.delete(event.pointerId)
    touchGestureRef.current = null
    lastTouchTapRef.current = null
  }, [])

  return (
    <div
      className="viz-canvas canvas-mode"
      ref={containerRef}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handleTouchStart}
      onPointerMove={handleTouchMove}
      onPointerUp={handleTouchEnd}
      onPointerCancel={handleTouchCancel}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHover?.(null, 0, 0, 0)}
    >
      <canvas ref={canvasRef} className="trajectory-canvas" role="img" aria-label={ariaLabel} data-position-count={currentPositions.length} data-trail-count={trajectories.filter(trail => trail.coordinates.length >= 6).length} />

      <div className="canvas-label-layer" aria-hidden="true">
        <span
          className="floating-label reference-floating-label"
          style={{
            left: `${(projectPoint({ x: 0, y: 0 }, projection).x / Math.max(size.width, 1)) * 100}%`,
            top: `${(projectPoint({ x: 0, y: 0 }, projection).y / Math.max(size.height, 1)) * 100}%`,
          }}
        >
          {bodyDisplayName(referenceBody, language)}
        </span>

        {showEcliptic && [0.33, 0.66, 1.0].map((ratio) => {
          const ringAU = viewRadiusAU * ratio
          const ringPixelRadius = projection.drawableRadius * ratio
          const projected = {
            x: projection.centerX + ringPixelRadius,
            y: projection.centerY,
          }

          return (
            <span
              key={`grid-${ratio}`}
              className="grid-au-label"
              style={{
                left: `${(projected.x / Math.max(size.width, 1)) * 100}%`,
                top: `${(projected.y / Math.max(size.height, 1)) * 100}%`,
              }}
            >
              {ringAU.toFixed(1)} AU
            </span>
          )
        })}

        {labels.map(({ body, planarPosition }) => {
          const projected = projectPoint(planarPosition, projection)

          return (
            <span
              key={body.id}
              className={`floating-label ${body.kind === 'asteroid' ? 'minor-floating-label' : ''}`}
              style={{
                left: `${(projected.x / Math.max(size.width, 1)) * 100}%`,
                top: `${(projected.y / Math.max(size.height, 1)) * 100}%`,
              }}
            >
              {bodyDisplayName(body, language)}
            </span>
          )
        })}

        {lagrangePoints?.flatMap((group) =>
          group.points.map((lp) => {
            const projected = projectPoint(lp.position, projection)
            return (
              <span
                key={`${group.body.id}-${lp.label}`}
                className="lagrange-marker"
                style={{
                  left: `${(projected.x / Math.max(size.width, 1)) * 100}%`,
                  top: `${(projected.y / Math.max(size.height, 1)) * 100}%`,
                  color: lp.color,
                }}
                title={`${bodyDisplayName(group.body, language)} ${lp.label}`}
              >
                ◆
              </span>
            )
          }),
        )}

        {influenceCircles?.map((influence) => {
          const center = projectPoint(influence.position, projection)
          const radiusPx = influence.radiusAU * projection.scale
          const label = influence.definition === 'hill' ? influenceLabels.hill : influenceLabels.soi

          return (
            <div
              key={`${influence.definition}-${influence.body.id}`}
              className={`soi-circle influence-${influence.definition}`}
              style={{
                left: `${(center.x / Math.max(size.width, 1)) * 100}%`,
                top: `${(center.y / Math.max(size.height, 1)) * 100}%`,
                width: radiusPx * 2,
                height: radiusPx * 2,
              }}
              title={`${bodyDisplayName(influence.body, language)} ${label}: ${influence.radiusAU.toFixed(4)} AU`}
            />
          )
        })}

        {!currentPositions.length && <span className="empty-overlay-copy">{emptyLabel}</span>}
        {webglUnavailable && <span className="empty-overlay-copy">{webglUnavailableLabel}</span>}
      </div>
    </div>
  )
}
