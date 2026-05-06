import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GRID_LEVELS, SVG_PADDING, createProjection, projectPoint, unprojectPoint, type Projection } from '../lib/viewProjection'
import type { LagrangePoint } from '../lib/lagrange'
import type { CelestialBody, RenderedBodyPosition, TrajectorySample, Vector2 } from '../types'

type OrbitEllipse = {
  body: CelestialBody
  points: Vector2[]
}

type Props = {
  referenceBody: CelestialBody
  trajectories: TrajectorySample[]
  currentPositions: RenderedBodyPosition[]
  viewRadiusAU: number
  viewOffsetAU: { x: number; y: number }
  showOrbits?: boolean
  orbitEllipses?: OrbitEllipse[]
  onReferenceChange?: (bodyId: string) => void
  onHover?: (body: CelestialBody | null, distance: number, x: number, y: number) => void
  lagrangePoints?: { body: CelestialBody; points: LagrangePoint[] }[]
  soiCircles?: { body: CelestialBody; position: Vector2; radiusAU: number }[]
  planetOpacity?: number
  asteroidOpacity?: number
  moonOpacity?: number
}

type Geometry = {
  linePositions: Float32Array
  lineColors: Float32Array
  pointPositions: Float32Array
  pointColors: Float32Array
  pointSizes: Float32Array
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
const RING_SEGMENTS = 72

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

const NEO_CLASSES = new Set(['APO', 'ATE', 'AMO', 'ATI'])

function isNeo(body: CelestialBody) {
  return body.orbitClassCode !== undefined && NEO_CLASSES.has(body.orbitClassCode)
}

function isComet(body: CelestialBody) {
  if (!body.orbit) {
    return false
  }

  const e = body.orbit.model === 'planetaryApprox'
    ? body.orbit.base.eccentricity
    : body.orbit.eccentricity

  return e > 0.9
}

function neoDistanceColor(distanceAU: number, alpha: number) {
  const logDistance = Math.log(Math.max(distanceAU, 0.001))
  const t = Math.max(0, Math.min(1, (logDistance - Math.log(0.01)) / (Math.log(1.0) - Math.log(0.01))))

  const red = 1.0 - t
  const green = t < 0.5 ? t * 2 : 2 - t * 2
  const blue = t

  return [red, green, blue, alpha]
}

function getMagnitudeScaledSize(body: CelestialBody) {
  if (body.absoluteMagnitude === undefined) {
    return body.size
  }

  const factor = 1 + (15 - body.absoluteMagnitude) * 0.12
  return body.size * Math.max(0.6, Math.min(3, factor))
}

function hexToRgba(hexColor: string, alpha: number) {
  const normalized = hexColor.replace('#', '')
  const value = normalized.length === 3
    ? normalized
        .split('')
        .map((part) => part + part)
        .join('')
    : normalized

  const red = Number.parseInt(value.slice(0, 2), 16) / 255
  const green = Number.parseInt(value.slice(2, 4), 16) / 255
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255

  return [red, green, blue, alpha]
}

function toClipSpace(point: { x: number; y: number }, projection: Projection) {
  return {
    x: (point.x / projection.width) * 2 - 1,
    y: 1 - (point.y / projection.height) * 2,
  }
}

function pushVertex(
  positions: number[],
  colors: number[],
  x: number,
  y: number,
  rgba: number[],
) {
  positions.push(x, y)
  colors.push(rgba[0], rgba[1], rgba[2], rgba[3])
}

function pushLineSegment(
  positions: number[],
  colors: number[],
  start: { x: number; y: number },
  end: { x: number; y: number },
  rgba: number[],
) {
  pushVertex(positions, colors, start.x, start.y, rgba)
  pushVertex(positions, colors, end.x, end.y, rgba)
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

function buildGeometry(
  projection: Projection,
  referenceBody: CelestialBody,
  trajectories: TrajectorySample[],
  currentPositions: RenderedBodyPosition[],
  showOrbits: boolean,
  orbitEllipses: OrbitEllipse[],
  planetOpacity: number,
  asteroidOpacity: number,
  moonOpacity: number,
): Geometry {
  const linePositions: number[] = []
  const lineColors: number[] = []
  const pointPositions: number[] = []
  const pointColors: number[] = []
  const pointSizes: number[] = []
  const gridColor = [173 / 255, 201 / 255, 1, 0.18]
  const haloColor = [1, 1, 1, 0.18]
  const projectedReferencePoint = projectPoint({ x: 0, y: 0 }, projection)

  for (const ratio of GRID_LEVELS) {
    for (let index = 0; index < RING_SEGMENTS; index += 1) {
      const startAngle = (index / RING_SEGMENTS) * Math.PI * 2
      const endAngle = ((index + 1) / RING_SEGMENTS) * Math.PI * 2
      const radius = projection.drawableRadius * ratio

      pushLineSegment(
        linePositions,
        lineColors,
        toClipSpace(
          {
            x: projection.centerX + Math.cos(startAngle) * radius,
            y: projection.centerY + Math.sin(startAngle) * radius,
          },
          projection,
        ),
        toClipSpace(
          {
            x: projection.centerX + Math.cos(endAngle) * radius,
            y: projection.centerY + Math.sin(endAngle) * radius,
          },
          projection,
        ),
        gridColor,
      )
    }
  }

  pushLineSegment(
    linePositions,
    lineColors,
    toClipSpace({ x: projection.padding, y: projection.centerY }, projection),
    toClipSpace({ x: projection.width - projection.padding, y: projection.centerY }, projection),
    gridColor,
  )
  pushLineSegment(
    linePositions,
    lineColors,
    toClipSpace({ x: projection.centerX, y: projection.padding }, projection),
    toClipSpace({ x: projection.centerX, y: projection.height - projection.padding }, projection),
    gridColor,
  )

  const haloSegments = 48
  for (let index = 0; index < haloSegments; index += 1) {
    const startAngle = (index / haloSegments) * Math.PI * 2
    const endAngle = ((index + 1) / haloSegments) * Math.PI * 2
    const radius = 16

    pushLineSegment(
      linePositions,
      lineColors,
      toClipSpace(
        {
          x: projectedReferencePoint.x + Math.cos(startAngle) * radius,
          y: projectedReferencePoint.y + Math.sin(startAngle) * radius,
        },
        projection,
      ),
      toClipSpace(
        {
          x: projectedReferencePoint.x + Math.cos(endAngle) * radius,
          y: projectedReferencePoint.y + Math.sin(endAngle) * radius,
        },
        projection,
      ),
      haloColor,
    )
  }

  const distanceByBodyId = new Map(
    currentPositions.map((item) => [item.body.id, item.distance]),
  )
  const isEarthReference = referenceBody.id === 'earth'

  for (const trajectory of trajectories) {
    if (trajectory.points.length < 2) {
      continue
    }

    const bodyDistance = distanceByBodyId.get(trajectory.body.id) ?? 0
    const useNeoColor = isEarthReference && isNeo(trajectory.body)
    const isCometBody = isComet(trajectory.body)
    const color = isCometBody
      ? hexToRgba('#44dddd', 0.5 * asteroidOpacity)
      : useNeoColor
        ? neoDistanceColor(bodyDistance, 0.6)
        : hexToRgba(
            trajectory.body.color,
            (trajectory.body.kind === 'asteroid' ? 0.3 : trajectory.body.kind === 'moon' ? 0.75 : 0.92) *
              (trajectory.body.kind === 'planet' || trajectory.body.kind === 'dwarfPlanet' ? planetOpacity : trajectory.body.kind === 'moon' ? moonOpacity : asteroidOpacity),
          )

    for (let index = 1; index < trajectory.points.length; index += 1) {
      const previous = toClipSpace(projectPoint(trajectory.points[index - 1], projection), projection)
      const current = toClipSpace(projectPoint(trajectory.points[index], projection), projection)
      pushLineSegment(linePositions, lineColors, previous, current, color)
    }
  }

  if (showOrbits) {
    for (const ellipse of orbitEllipses) {
      if (ellipse.points.length < 2) {
        continue
      }

      const color = hexToRgba(ellipse.body.color, 0.18)

      for (let index = 1; index < ellipse.points.length; index += 1) {
        const previous = toClipSpace(projectPoint(ellipse.points[index - 1], projection), projection)
        const current = toClipSpace(projectPoint(ellipse.points[index], projection), projection)
        pushLineSegment(linePositions, lineColors, previous, current, color)
      }
    }
  }

  const referenceColor = hexToRgba(referenceBody.color, 1)
  const referencePoint = toClipSpace(projectedReferencePoint, projection)
  pushVertex(pointPositions, pointColors, referencePoint.x, referencePoint.y, referenceColor)
  pointSizes.push(7)

  for (const item of currentPositions) {
    const projected = toClipSpace(projectPoint(item.planarPosition, projection), projection)
    const useNeoColor = isEarthReference && isNeo(item.body)
    const typeOpacity = item.body.kind === 'planet' || item.body.kind === 'dwarfPlanet'
      ? planetOpacity
      : item.body.kind === 'moon'
        ? moonOpacity
        : asteroidOpacity
    const color = useNeoColor
      ? neoDistanceColor(item.distance, 0.92 * typeOpacity)
      : hexToRgba(item.body.color, (item.body.kind === 'asteroid' ? 0.92 : 1) * typeOpacity)
    pushVertex(pointPositions, pointColors, projected.x, projected.y, color)
    pointSizes.push(getMagnitudeScaledSize(item.body))
  }

  return {
    linePositions: new Float32Array(linePositions),
    lineColors: new Float32Array(lineColors),
    pointPositions: new Float32Array(pointPositions),
    pointColors: new Float32Array(pointColors),
    pointSizes: new Float32Array(pointSizes),
  }
}

function drawLines(resources: GlResources, geometry: Geometry) {
  const { gl, lineProgram, linePositionBuffer, lineColorBuffer } = resources
  if (!geometry.linePositions.length) {
    return
  }

  resetVertexAttributes(gl)
  gl.useProgram(lineProgram)

  const positionLocation = gl.getAttribLocation(lineProgram, 'aPosition')
  const colorLocation = gl.getAttribLocation(lineProgram, 'aColor')

  gl.bindBuffer(gl.ARRAY_BUFFER, linePositionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, geometry.linePositions, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ARRAY_BUFFER, lineColorBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, geometry.lineColors, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(colorLocation)
  gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0)

  gl.drawArrays(gl.LINES, 0, geometry.linePositions.length / 2)
}

function drawPoints(resources: GlResources, geometry: Geometry, pixelRatio: number) {
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
  gl.bufferData(gl.ARRAY_BUFFER, geometry.pointPositions, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ARRAY_BUFFER, pointColorBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, geometry.pointColors, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(colorLocation)
  gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ARRAY_BUFFER, pointSizeBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, geometry.pointSizes, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(sizeLocation)
  gl.vertexAttribPointer(sizeLocation, 1, gl.FLOAT, false, 0, 0)

  gl.drawArrays(gl.POINTS, 0, geometry.pointPositions.length / 2)
}

export function TrajectoryCanvas({
  referenceBody,
  trajectories,
  currentPositions,
  viewRadiusAU,
  viewOffsetAU,
  showOrbits,
  orbitEllipses,
  onReferenceChange,
  onHover,
  lagrangePoints,
  soiCircles,
  planetOpacity = 1,
  asteroidOpacity = 1,
  moonOpacity = 1,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const resourcesRef = useRef<GlResources | null>(null)
  const [containerRef, size] = useElementSize<HTMLDivElement>()
  const [webglUnavailable, setWebglUnavailable] = useState(false)

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
    const majorBodies = currentPositions.filter((item) => item.body.kind !== 'asteroid').slice(0, MAJOR_LABEL_LIMIT)
    const asteroidBodies = currentPositions.filter((item) => item.body.kind === 'asteroid').slice(0, ASTEROID_LABEL_LIMIT)
    return [...majorBodies, ...asteroidBodies]
  }, [currentPositions])

  const geometry = useMemo(
    () =>
      buildGeometry(
        projection,
        referenceBody,
        trajectories,
        currentPositions,
        showOrbits ?? false,
        orbitEllipses ?? [],
        planetOpacity,
        asteroidOpacity,
        moonOpacity,
      ),
    [asteroidOpacity, currentPositions, moonOpacity, orbitEllipses, planetOpacity, projection, referenceBody, showOrbits, trajectories],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const width = Math.max(size.width, 1)
    const height = Math.max(size.height, 1)
    const pixelRatio = window.devicePixelRatio || 1

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

    const { gl } = resources
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    drawLines(resources, geometry)
    drawPoints(resources, geometry, pixelRatio)
  }, [geometry, size.height, size.width])

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

      for (const item of currentPositions) {
        const dx = item.planarPosition.x - worldPoint.x
        const dy = item.planarPosition.y - worldPoint.y
        const dist = Math.hypot(dx, dy)

        if (dist < thresholdAU && dist < nearestDistance) {
          nearestDistance = dist
          nearestBody = item.body.id
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

      let nearestItem: (typeof currentPositions)[number] | null = null
      let nearestDistance = Number.POSITIVE_INFINITY

      for (const item of currentPositions) {
        const dx = item.planarPosition.x - worldPoint.x
        const dy = item.planarPosition.y - worldPoint.y
        const dist = Math.hypot(dx, dy)

        if (dist < thresholdAU && dist < nearestDistance) {
          nearestDistance = dist
          nearestItem = item
        }
      }

      if (nearestItem) {
        onHover(nearestItem.body, nearestItem.distance, event.clientX, event.clientY)
      } else {
        onHover(null, 0, 0, 0)
      }
    },
    [currentPositions, onHover, projection, viewRadiusAU],
  )

  return (
    <div
      className="viz-canvas canvas-mode"
      ref={containerRef}
      onDoubleClick={handleDoubleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHover?.(null, 0, 0, 0)}
    >
      <canvas ref={canvasRef} className="trajectory-canvas" role="img" aria-label="太阳系轨迹平面图" />

      <div className="canvas-label-layer" aria-hidden="true">
        <span
          className="floating-label reference-floating-label"
          style={{
            left: `${(projectPoint({ x: 0, y: 0 }, projection).x / Math.max(size.width, 1)) * 100}%`,
            top: `${(projectPoint({ x: 0, y: 0 }, projection).y / Math.max(size.height, 1)) * 100}%`,
          }}
        >
          {referenceBody.name}
        </span>

        {[0.33, 0.66, 1.0].map((ratio) => {
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
              {body.shortName ?? body.name}
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
                title={`${group.body.name} ${lp.label}`}
              >
                ◆
              </span>
            )
          }),
        )}

        {soiCircles?.map((soi) => {
          const center = projectPoint(soi.position, projection)
          const radiusPx = soi.radiusAU * projection.scale

          return (
            <div
              key={`soi-${soi.body.id}`}
              className="soi-circle"
              style={{
                left: `${(center.x / Math.max(size.width, 1)) * 100}%`,
                top: `${(center.y / Math.max(size.height, 1)) * 100}%`,
                width: radiusPx * 2,
                height: radiusPx * 2,
              }}
              title={`${soi.body.name} Hill Sphere: ${soi.radiusAU.toFixed(4)} AU`}
            />
          )
        })}

        {!currentPositions.length && <span className="empty-overlay-copy">请先选择至少一个要显示的天体</span>}
        {webglUnavailable && <span className="empty-overlay-copy">当前浏览器不支持 WebGL 加速渲染</span>}
      </div>
    </div>
  )
}
