import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { LagrangePoint } from '../lib/lagrange'
import type { CelestialBody, RenderedBodyPosition, TrajectorySample } from '../types'

type Props = {
  referenceBody: CelestialBody
  trajectories: TrajectorySample[]
  currentPositions: RenderedBodyPosition[]
  onReferenceChange?: (bodyId: string) => void
  onHover?: (body: CelestialBody | null, distance: number, x: number, y: number) => void
  lagrangePoints?: { body: CelestialBody; points: LagrangePoint[] }[]
  showEcliptic?: boolean
}

function createBodySphere(body: CelestialBody, position: THREE.Vector3) {
  const geometry = new THREE.SphereGeometry(body.kind === 'star' ? 0.12 : body.kind === 'planet' ? 0.08 : 0.04, 16, 16)
  const material = new THREE.MeshBasicMaterial({ color: body.color })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.copy(position)
  mesh.userData.bodyId = body.id
  return mesh
}

export function TrajectoryCanvas3D({
  referenceBody,
  trajectories,
  currentPositions,
  onReferenceChange,
  onHover,
  lagrangePoints: _lagrangePoints,
  showEcliptic,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const meshesRef = useRef<THREE.Object3D[]>([])
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster())

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const width = container.clientWidth
    const height = container.clientHeight

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a14)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, width / Math.max(height, 1), 0.01, 200)
    camera.position.set(0, 3, 5)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controlsRef.current = controls

    const gridHelper = new THREE.PolarGridHelper(3, 24, 16, 64, 0x334466, 0x334466)
    scene.add(gridHelper)

    if (showEcliptic) {
      const eclipticGeo = new THREE.CircleGeometry(5, 64)
      const eclipticMat = new THREE.MeshBasicMaterial({
        color: 0x4466aa,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.08,
      })

      const eclipticPlane = new THREE.Mesh(eclipticGeo, eclipticMat)
      eclipticPlane.rotation.x = -Math.PI / 2
      eclipticPlane.name = 'ecliptic-plane'
      scene.add(eclipticPlane)

      const ringGeo = new THREE.TorusGeometry(5, 0.015, 16, 100)
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x4466aa, transparent: true, opacity: 0.25 })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = -Math.PI / 2
      ring.name = 'ecliptic-ring'
      scene.add(ring)
    }

    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
    }

    renderer.setAnimationLoop(animate)

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / Math.max(h, 1)
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
      scene.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) {
      return
    }

    for (const obj of meshesRef.current) {
      scene.remove(obj)
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose()
        if (Array.isArray(obj.material)) {
          for (const mat of obj.material) {
            mat.dispose()
          }
        } else {
          obj.material.dispose()
        }
      }
    }

    meshesRef.current = []

    for (const trajectory of trajectories) {
      const points3D = trajectory.points3D
      if (!points3D || points3D.length < 2) {
        const pos = currentPositions.find((p) => p.body.id === trajectory.body.id)
        if (pos?.position3D) {
          const sphere = createBodySphere(
            trajectory.body,
            new THREE.Vector3(pos.position3D.x, pos.position3D.z, pos.position3D.y),
          )

          scene.add(sphere)
          meshesRef.current.push(sphere)
        }

        continue
      }

      const linePoints = points3D.map((p) => new THREE.Vector3(p.x, p.z, p.y))
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints)
      const lineMaterial = new THREE.LineBasicMaterial({
        color: trajectory.body.color,
        transparent: true,
        opacity: trajectory.body.kind === 'asteroid' ? 0.4 : 0.8,
      })

      const line = new THREE.Line(lineGeometry, lineMaterial)
      scene.add(line)
      meshesRef.current.push(line)
    }

    for (const item of currentPositions) {
      if (item.position3D) {
        const sphere = createBodySphere(
          item.body,
          new THREE.Vector3(item.position3D.x, item.position3D.z, item.position3D.y),
        )

        scene.add(sphere)
        meshesRef.current.push(sphere)
      }
    }

    const referenceSphere = createBodySphere(referenceBody, new THREE.Vector3(0, 0, 0))
    scene.add(referenceSphere)
    meshesRef.current.push(referenceSphere)

    if (_lagrangePoints) {
      for (const group of _lagrangePoints) {
        for (const lp of group.points) {
          const geo = new THREE.SphereGeometry(0.03, 8, 8)
          const mat = new THREE.MeshBasicMaterial({ color: lp.color })
          const mesh = new THREE.Mesh(geo, mat)
          mesh.position.set(lp.position.x, 0, lp.position.y)
          scene.add(mesh)
          meshesRef.current.push(mesh)
        }
      }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trajectories, currentPositions, referenceBody.id, _lagrangePoints, showEcliptic])

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onReferenceChange) {
        return
      }

      const container = containerRef.current
      const camera = cameraRef.current
      const scene = sceneRef.current
      if (!container || !camera || !scene) {
        return
      }

      const rect = container.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )

      const raycaster = raycasterRef.current
      raycaster.setFromCamera(mouse, camera)

      const clickable = meshesRef.current.filter(
        (obj) => obj instanceof THREE.Mesh && obj.userData.bodyId,
      )

      const intersections = raycaster.intersectObjects(clickable, false)

      if (intersections.length > 0) {
        const bodyId = intersections[0].object.userData.bodyId as string | undefined
        if (bodyId) {
          onReferenceChange(bodyId)
        }
      }
    },
    [onReferenceChange],
  )

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onHover) {
        return
      }

      const container = containerRef.current
      const camera = cameraRef.current
      const scene = sceneRef.current
      if (!container || !camera || !scene) {
        return
      }

      const rect = container.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )

      const raycaster = raycasterRef.current
      raycaster.setFromCamera(mouse, camera)

      const clickable = meshesRef.current.filter(
        (obj) => obj instanceof THREE.Mesh && obj.userData.bodyId,
      )

      const intersections = raycaster.intersectObjects(clickable, false)

      if (intersections.length > 0) {
        const bodyId = intersections[0].object.userData.bodyId as string | undefined
        if (bodyId) {
          const pos = currentPositions.find((p) => p.body.id === bodyId)
          if (pos) {
            onHover(pos.body, pos.distance, event.clientX, event.clientY)
            return
          }
        }
      }

      onHover(null, 0, 0, 0)
    },
    [currentPositions, onHover],
  )

  return (
    <div
      ref={containerRef}
      className="viz-canvas canvas-mode"
      onDoubleClick={handleDoubleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHover?.(null, 0, 0, 0)}
    />
  )
}
