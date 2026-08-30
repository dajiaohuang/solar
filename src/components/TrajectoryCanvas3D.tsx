import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PREPARE_CANVAS_CAPTURE_EVENT } from '../lib/canvasCapture'
import { cameraDistanceForFit, cameraRangeForFit, clamp3dZoom } from '../lib/camera3d'
import type { LagrangePoint } from '../lib/lagrange'
import { createTrajectoryScene } from '../lib/trajectoryScene3d'
import type { AsteroidRecord, CelestialBody, RenderedBodyPosition, TrajectorySample, Vector3 } from '../types'

type Props = {
  referenceBody: CelestialBody
  trajectories: TrajectorySample[]
  currentPositions: RenderedBodyPosition[]
  onReferenceChange?: (bodyId: string) => void
  onBodySelect?: (bodyId: string) => void
  onHover?: (body: CelestialBody | null, distance: number, x: number, y: number) => void
  lagrangePoints?: { body: CelestialBody; points: LagrangePoint[] }[]
  showEcliptic?: boolean
  showSaturnRings?: boolean
  showGlow?: boolean
  ariaLabel?: string
  fallbackLabel?: string
  onUnavailable?: () => void
  catalogRecords?: AsteroidRecord[]
  catalogPositions3D?: Float32Array
  catalogDrawCount?: number
  catalogOrigin?: Vector3
  catalogFitKey?: string
  continuous?: boolean
  pixelRatioLimit?: number
  onFrameDuration?: (durationMs: number) => void
  zoomLevel?: number
  resetViewKey?: number
}

type SceneResources = {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  bodyGeometry: THREE.SphereGeometry
  bodyMeshes: Map<string, THREE.Mesh>
  trajectoryLines: Map<string, THREE.Line>
  auxiliaryGroup: THREE.Group
  lagrangeGeometry: THREE.SphereGeometry
  lagrangeMeshes: Map<string, THREE.Mesh>
  saturnRing: THREE.Mesh
  eclipticGroup: THREE.Group
  glow: THREE.Sprite
  glowTexture: THREE.Texture
  catalogPoints: THREE.Points
  bodyScale: number
  fitDistance: number
}

const EMPTY_CATALOG_RECORDS: AsteroidRecord[] = []
const EMPTY_CATALOG_POSITIONS = new Float32Array()
const HELIOCENTRIC_ORIGIN = { x: 0, y: 0, z: 0 }

function radiusFor(body: CelestialBody) {
  const base = body.kind === 'star' ? 0.12 : body.kind === 'planet' ? 0.075 : body.kind === 'moon' ? 0.042 : 0.032
  if (body.absoluteMagnitude === undefined) return base
  return base * Math.max(0.65, Math.min(2.6, 1 + (15 - body.absoluteMagnitude) * 0.1))
}

function toThree(position: { x: number; y: number; z: number }) {
  return new THREE.Vector3(position.x, position.z, position.y)
}

function updateCameraData(container: HTMLDivElement, resources: SceneResources) {
  container.dataset.cameraDistance = resources.camera.position.distanceTo(resources.controls.target).toFixed(6)
  container.dataset.cameraPosition = resources.camera.position.toArray().map((value) => value.toFixed(6)).join(',')
}

function resetCameraToFit(resources: SceneResources, zoom: number) {
  const distance = Math.max(resources.controls.minDistance, cameraDistanceForFit(resources.fitDistance, zoom))
  resources.camera.position.set(0.16, 0.48, 1).setLength(distance)
  resources.controls.target.set(0, 0, 0)
  resources.controls.update()
}

function disposeObject(object: THREE.Object3D) {
  if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material.dispose()
  }
}

function createGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(48, 48, 0, 48, 48, 48)
    gradient.addColorStop(0, 'rgba(255,240,170,1)')
    gradient.addColorStop(0.18, 'rgba(255,190,72,.75)')
    gradient.addColorStop(0.55, 'rgba(255,121,30,.13)')
    gradient.addColorStop(1, 'rgba(255,80,0,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 96, 96)
  }
  return new THREE.CanvasTexture(canvas)
}

export function TrajectoryCanvas3D({
  referenceBody,
  trajectories,
  currentPositions,
  onReferenceChange,
  onBodySelect,
  onHover,
  lagrangePoints,
  showEcliptic = true,
  showSaturnRings = true,
  showGlow = true,
  ariaLabel = 'Interactive three-dimensional Solar System trajectory view',
  fallbackLabel = 'Three-dimensional WebGL rendering is unavailable.',
  onUnavailable,
  catalogRecords = EMPTY_CATALOG_RECORDS,
  catalogPositions3D = EMPTY_CATALOG_POSITIONS,
  catalogDrawCount = 0,
  catalogOrigin = HELIOCENTRIC_ORIGIN,
  catalogFitKey = '',
  continuous = false,
  pixelRatioLimit = 1.75,
  onFrameDuration,
  zoomLevel = 1,
  resetViewKey = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const resourcesRef = useRef<SceneResources | null>(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const positionsRef = useRef(currentPositions)
  const lastTouchTapRef = useRef<{ bodyId: string; timestamp: number } | null>(null)
  const touchGestureRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null)
  const activeTouchPointersRef = useRef(new Set<number>())
  const fitKeyRef = useRef('')
  const appliedZoomRef = useRef(clamp3dZoom(zoomLevel))
  const appliedResetKeyRef = useRef(resetViewKey)
  const onUnavailableRef = useRef(onUnavailable)
  const fallbackLabelRef = useRef(fallbackLabel)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  useEffect(() => { onUnavailableRef.current = onUnavailable; fallbackLabelRef.current = fallbackLabel }, [fallbackLabel, onUnavailable])
  useEffect(() => { positionsRef.current = currentPositions }, [currentPositions])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scene = createTrajectoryScene()
    const camera = new THREE.PerspectiveCamera(42, container.clientWidth / Math.max(container.clientHeight, 1), 0.005, 500)
    camera.position.set(0, 4.2, 7.5)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch (error) {
      const failureFrame = window.requestAnimationFrame(() => {
        setUnavailable(error instanceof Error ? error.message : fallbackLabelRef.current)
        onUnavailableRef.current?.()
      })
      return () => window.cancelAnimationFrame(failureFrame)
    }
    renderer.setPixelRatio(1)
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(renderer.domElement)
    const handleContextLost = (event: Event) => {
      event.preventDefault()
      setUnavailable(fallbackLabelRef.current)
      onUnavailableRef.current?.()
    }
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.minDistance = 0.08
    controls.maxDistance = 220

    const grid = new THREE.PolarGridHelper(8, 24, 12, 96, 0x33465a, 0x172431)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.42
    scene.add(grid)

    const eclipticGroup = new THREE.Group()
    const plane = new THREE.Mesh(
      new THREE.CircleGeometry(8, 96),
      new THREE.MeshBasicMaterial({ color: 0x36506c, side: THREE.DoubleSide, transparent: true, opacity: 0.075 }),
    )
    plane.rotation.x = -Math.PI / 2
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(8, 0.008, 6, 128),
      new THREE.MeshBasicMaterial({ color: 0x5e87a5, transparent: true, opacity: 0.38 }),
    )
    ring.rotation.x = Math.PI / 2
    eclipticGroup.add(plane, ring)
    scene.add(eclipticGroup)

    const auxiliaryGroup = new THREE.Group()
    scene.add(auxiliaryGroup)
    const lagrangeGeometry = new THREE.SphereGeometry(0.026, 8, 6)
    const saturnRing = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.21, 48),
      new THREE.MeshBasicMaterial({ color: 0xd9bf8b, side: THREE.DoubleSide, transparent: true, opacity: 0.48 }),
    )
    saturnRing.rotation.x = Math.PI / 2 + 0.47
    saturnRing.visible = false
    auxiliaryGroup.add(saturnRing)
    const glowTexture = createGlowTexture()
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, blending: THREE.AdditiveBlending }))
    glow.scale.setScalar(0.9)
    scene.add(glow)
    const catalogPoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ size: 0.018, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.72 }),
    )
    catalogPoints.frustumCulled = false
    scene.add(catalogPoints)

    const resources: SceneResources = {
      scene,
      renderer,
      camera,
      controls,
      bodyGeometry: new THREE.SphereGeometry(1, 16, 12),
      bodyMeshes: new Map(),
      trajectoryLines: new Map(),
      auxiliaryGroup,
      lagrangeGeometry,
      lagrangeMeshes: new Map(),
      saturnRing,
      eclipticGroup,
      glow,
      glowTexture,
      catalogPoints,
      bodyScale: 1,
      fitDistance: 8.7,
    }
    resourcesRef.current = resources
    const render = () => {
      updateCameraData(container, resources)
      renderer.render(scene, camera)
    }
    controls.addEventListener('change', render)
    renderer.domElement.addEventListener(PREPARE_CANVAS_CAPTURE_EVENT, render)
    render()
    const observer = new ResizeObserver(() => {
      const width = Math.max(container.clientWidth, 1)
      const height = Math.max(container.clientHeight, 1)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
      render()
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost)
      renderer.domElement.removeEventListener(PREPARE_CANVAS_CAPTURE_EVENT, render)
      controls.removeEventListener('change', render)
      controls.dispose()
      for (const line of resources.trajectoryLines.values()) disposeObject(line)
      for (const mesh of resources.bodyMeshes.values()) (mesh.material as THREE.Material).dispose()
      resources.bodyGeometry.dispose()
      for (const mesh of resources.lagrangeMeshes.values()) (mesh.material as THREE.Material).dispose()
      resources.lagrangeGeometry.dispose()
      disposeObject(resources.saturnRing)
      for (const object of [...resources.eclipticGroup.children]) disposeObject(object)
      disposeObject(grid)
      ;(resources.glow.material as THREE.Material).dispose()
      resources.glowTexture.dispose()
      disposeObject(resources.catalogPoints)
      renderer.dispose()
      container.removeChild(renderer.domElement)
      resourcesRef.current = null
    }
  }, [])

  useEffect(() => {
    const resources = resourcesRef.current
    const container = containerRef.current
    if (!resources || !container) return
    resources.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioLimit))
    resources.renderer.setSize(Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1))
    resources.renderer.render(resources.scene, resources.camera)
  }, [pixelRatioLimit])

  useEffect(() => {
    if (!continuous) return
    let animationFrame = 0
    let previous = performance.now()
    const renderFrame = (timestamp: number) => {
      const resources = resourcesRef.current
      if (!resources) return
      if (!document.hidden) {
        resources.renderer.render(resources.scene, resources.camera)
        onFrameDuration?.(timestamp - previous)
      }
      previous = timestamp
      animationFrame = window.requestAnimationFrame(renderFrame)
    }
    animationFrame = window.requestAnimationFrame(renderFrame)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [continuous, onFrameDuration])

  useEffect(() => {
    const resources = resourcesRef.current
    if (!resources) return
    const count = Math.min(catalogRecords.length, Math.floor(catalogPositions3D.length / 3))
    const cloudPositions = new Float32Array(count * 3)
    const cloudColors = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      cloudPositions[index * 3] = catalogPositions3D[index * 3]
      cloudPositions[index * 3 + 1] = catalogPositions3D[index * 3 + 2]
      cloudPositions[index * 3 + 2] = catalogPositions3D[index * 3 + 1]
      const record = catalogRecords[index]
      const color = record.isPha ? [1, 0.35, 0.3] : record.isNeo ? [1, 0.62, 0.5] : [0.62, 0.7, 0.76]
      cloudColors.set(color, index * 3)
    }
    resources.catalogPoints.geometry.dispose()
    resources.catalogPoints.geometry = new THREE.BufferGeometry()
    resources.catalogPoints.geometry.setAttribute('position', new THREE.BufferAttribute(cloudPositions, 3))
    resources.catalogPoints.geometry.setAttribute('color', new THREE.BufferAttribute(cloudColors, 3))
    resources.catalogPoints.visible = count > 0
    resources.renderer.render(resources.scene, resources.camera)
  }, [catalogPositions3D, catalogRecords])

  useEffect(() => {
    const resources = resourcesRef.current
    if (!resources) return
    const available = Math.min(catalogRecords.length, Math.floor(catalogPositions3D.length / 3))
    resources.catalogPoints.geometry.setDrawRange(0, Math.min(catalogDrawCount, available))
    resources.catalogPoints.visible = catalogDrawCount > 0 && available > 0
    resources.renderer.render(resources.scene, resources.camera)
  }, [catalogDrawCount, catalogPositions3D.length, catalogRecords.length])

  useEffect(() => {
    const resources = resourcesRef.current
    if (!resources) return
    resources.catalogPoints.position.copy(toThree({ x: -catalogOrigin.x, y: -catalogOrigin.y, z: -catalogOrigin.z }))
    resources.renderer.render(resources.scene, resources.camera)
  }, [catalogOrigin])

  useEffect(() => {
    const resources = resourcesRef.current
    if (!resources) return
    resources.eclipticGroup.visible = showEcliptic
    resources.glow.visible = showGlow && referenceBody.id === 'sun'

    const activeLineIds = new Set<string>()
    for (const trajectory of trajectories) {
      const source = trajectory.points3D
      if (!source || source.length < 2) continue
      activeLineIds.add(trajectory.body.id)
      const values = new Float32Array(source.length * 3)
      for (let index = 0; index < source.length; index += 1) {
        values[index * 3] = source[index].x
        values[index * 3 + 1] = source[index].z
        values[index * 3 + 2] = source[index].y
      }
      let line = resources.trajectoryLines.get(trajectory.body.id)
      if (!line) {
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(values, 3))
        line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
          color: trajectory.body.color,
          transparent: true,
          opacity: trajectory.body.kind === 'asteroid' ? 0.3 : 0.68,
        }))
        resources.trajectoryLines.set(trajectory.body.id, line)
        resources.scene.add(line)
      } else {
        const attribute = line.geometry.getAttribute('position') as THREE.BufferAttribute
        if (attribute.array.length === values.length) {
          ;(attribute.array as Float32Array).set(values)
          attribute.needsUpdate = true
          line.geometry.computeBoundingSphere()
        } else {
          line.geometry.dispose()
          line.geometry = new THREE.BufferGeometry()
          line.geometry.setAttribute('position', new THREE.BufferAttribute(values, 3))
        }
      }
    }
    for (const [id, line] of resources.trajectoryLines) {
      if (!activeLineIds.has(id)) {
        resources.scene.remove(line)
        disposeObject(line)
        resources.trajectoryLines.delete(id)
      }
    }

    const bodyPositions = new Map(currentPositions.map((item) => [item.body.id, item]))
    bodyPositions.set(referenceBody.id, {
      body: referenceBody,
      planarPosition: { x: 0, y: 0 },
      position3D: { x: 0, y: 0, z: 0 },
      distance: 0,
    })
    for (const [id, item] of bodyPositions) {
      let mesh = resources.bodyMeshes.get(id)
      if (!mesh) {
        mesh = new THREE.Mesh(resources.bodyGeometry, new THREE.MeshBasicMaterial({ color: item.body.color }))
        mesh.userData.bodyId = id
        resources.bodyMeshes.set(id, mesh)
        resources.scene.add(mesh)
      }
      mesh.scale.setScalar(radiusFor(item.body) * resources.bodyScale)
      if (item.position3D) mesh.position.copy(toThree(item.position3D))
    }
    for (const [id, mesh] of resources.bodyMeshes) {
      if (!bodyPositions.has(id)) {
        resources.scene.remove(mesh)
        ;(mesh.material as THREE.Material).dispose()
        resources.bodyMeshes.delete(id)
      }
    }

    // Reframe only when the scene composition changes, preserving deliberate
    // user camera moves during clock playback while keeping story/catalog
    // scenes (including outbound spacecraft paths) discoverable.
    const catalogReady = catalogDrawCount > 0 && catalogPositions3D.length >= 3
    const fitKey = `${referenceBody.id}|${[...bodyPositions.keys()].sort().join(',')}|${trajectories.map((item) => `${item.body.id}:${item.points3D?.length ?? 0}`).sort().join(',')}|${catalogReady ? catalogFitKey : ''}`
    if (fitKeyRef.current !== fitKey) {
      fitKeyRef.current = fitKey
      let radius = 0
      for (const item of bodyPositions.values()) {
        if (item.position3D) radius = Math.max(radius, Math.hypot(item.position3D.x, item.position3D.y, item.position3D.z))
      }
      for (const trajectory of trajectories) {
        if (trajectory.body.kind === 'spacecraft') continue
        for (const point of trajectory.points3D ?? []) radius = Math.max(radius, Math.hypot(point.x, point.y, point.z))
      }
      // Fit the complete ready sample once so later adaptive draw-range growth
      // cannot introduce points outside the user's initial catalog framing.
      const catalogCount = Math.min(catalogRecords.length, Math.floor(catalogPositions3D.length / 3))
      for (let index = 0; index < catalogCount; index += 1) {
        radius = Math.max(radius, Math.hypot(
          catalogPositions3D[index * 3] - catalogOrigin.x,
          catalogPositions3D[index * 3 + 1] - catalogOrigin.y,
          catalogPositions3D[index * 3 + 2] - catalogOrigin.z,
        ))
      }
      const distance = Math.max(2.8, Math.min(260, radius * 1.45 + 1.4))
      resources.bodyScale = Math.max(1, Math.min(4.5, Math.sqrt(Math.max(radius, 1) / 7)))
      for (const [id, mesh] of resources.bodyMeshes) {
        const item = bodyPositions.get(id)
        if (item) mesh.scale.setScalar(radiusFor(item.body) * resources.bodyScale)
      }
      resources.fitDistance = distance
      const cameraRange = cameraRangeForFit(distance, radius)
      resources.camera.far = cameraRange.far
      resources.camera.updateProjectionMatrix()
      resources.controls.maxDistance = cameraRange.maxDistance
      resetCameraToFit(resources, zoomLevel)
      appliedZoomRef.current = clamp3dZoom(zoomLevel)
    }

    const activeLagrangeIds = new Set<string>()
    for (const group of lagrangePoints ?? []) {
      for (const point of group.points) {
        const markerId = `${group.body.id}:${point.label}`
        activeLagrangeIds.add(markerId)
        let marker = resources.lagrangeMeshes.get(markerId)
        if (!marker) {
          marker = new THREE.Mesh(resources.lagrangeGeometry, new THREE.MeshBasicMaterial({ color: point.color }))
          resources.lagrangeMeshes.set(markerId, marker)
          resources.auxiliaryGroup.add(marker)
        }
        marker.position.set(point.position.x, 0, point.position.y)
      }
    }
    for (const [id, marker] of resources.lagrangeMeshes) {
      if (activeLagrangeIds.has(id)) continue
      resources.auxiliaryGroup.remove(marker)
      ;(marker.material as THREE.Material).dispose()
      resources.lagrangeMeshes.delete(id)
    }
    resources.saturnRing.visible = false
    if (showSaturnRings) {
      const saturn = bodyPositions.get('saturn')
      if (saturn?.position3D) {
        resources.saturnRing.position.copy(toThree(saturn.position3D))
        resources.saturnRing.visible = true
      }
    }
    const container = containerRef.current
    if (container) updateCameraData(container, resources)
    resources.renderer.render(resources.scene, resources.camera)
  }, [catalogDrawCount, catalogFitKey, catalogOrigin.x, catalogOrigin.y, catalogOrigin.z, catalogPositions3D, catalogRecords.length, currentPositions, lagrangePoints, referenceBody, showEcliptic, showGlow, showSaturnRings, trajectories, zoomLevel])

  useEffect(() => {
    const resources = resourcesRef.current
    const container = containerRef.current
    if (!resources || !container) return
    const nextZoom = clamp3dZoom(zoomLevel)
    const previousZoom = appliedZoomRef.current
    if (Math.abs(nextZoom - previousZoom) < 1e-9) return
    const cameraOffset = resources.camera.position.clone().sub(resources.controls.target)
    const nextDistance = Math.max(resources.controls.minDistance, Math.min(resources.controls.maxDistance, cameraDistanceForFit(resources.fitDistance, nextZoom)))
    cameraOffset.setLength(nextDistance)
    resources.camera.position.copy(resources.controls.target).add(cameraOffset)
    appliedZoomRef.current = nextZoom
    resources.controls.update()
    updateCameraData(container, resources)
    resources.renderer.render(resources.scene, resources.camera)
  }, [zoomLevel])

  useEffect(() => {
    const resources = resourcesRef.current
    const container = containerRef.current
    if (!resources || !container || appliedResetKeyRef.current === resetViewKey) return
    appliedResetKeyRef.current = resetViewKey
    appliedZoomRef.current = clamp3dZoom(zoomLevel)
    resetCameraToFit(resources, zoomLevel)
    updateCameraData(container, resources)
    resources.renderer.render(resources.scene, resources.camera)
  }, [resetViewKey, zoomLevel])

  const intersectBody = useCallback((event: { clientX: number; clientY: number }) => {
    const container = containerRef.current
    const resources = resourcesRef.current
    if (!container || !resources) return null
    const rect = container.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1,
    )
    raycasterRef.current.setFromCamera(pointer, resources.camera)
    const hits = raycasterRef.current.intersectObjects([...resources.bodyMeshes.values()], false)
    return hits[0]?.object.userData.bodyId as string | undefined
  }, [])

  return (
    <div
      ref={containerRef}
      className="viz-canvas canvas-mode"
      data-testid="trajectory-canvas-3d"
      role="img"
      aria-label={ariaLabel}
      onClick={(event) => { const id = intersectBody(event); if (id) onBodySelect?.(id) }}
      onDoubleClick={(event) => { const id = intersectBody(event); if (id) onReferenceChange?.(id) }}
      onPointerDown={(event) => {
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
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== 'touch') return
        const gesture = touchGestureRef.current
        if (!gesture || gesture.pointerId !== event.pointerId) return
        if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 12) {
          gesture.moved = true
          lastTouchTapRef.current = null
        }
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== 'touch') return
        activeTouchPointersRef.current.delete(event.pointerId)
        const gesture = touchGestureRef.current
        touchGestureRef.current = null
        if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return
        const id = intersectBody(event)
        if (!id) {
          lastTouchTapRef.current = null
          return
        }
        const now = performance.now()
        const previous = lastTouchTapRef.current
        if (previous?.bodyId === id && now - previous.timestamp < 420) {
          onReferenceChange?.(id)
          lastTouchTapRef.current = null
        } else {
          lastTouchTapRef.current = { bodyId: id, timestamp: now }
        }
      }}
      onPointerCancel={(event) => {
        if (event.pointerType !== 'touch') return
        activeTouchPointersRef.current.delete(event.pointerId)
        touchGestureRef.current = null
        lastTouchTapRef.current = null
      }}
      onMouseMove={(event) => {
        const id = intersectBody(event)
        const position = positionsRef.current.find((item) => item.body.id === id)
        if (position) onHover?.(position.body, position.distance, event.clientX, event.clientY)
        else onHover?.(null, 0, 0, 0)
      }}
      onMouseLeave={() => onHover?.(null, 0, 0, 0)}
    >{unavailable && <div className="webgl-fallback" role="status"><span>◌</span><p>{fallbackLabel}</p></div>}</div>
  )
}
