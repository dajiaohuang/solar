import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CelestialBody, RenderedBodyPosition, TrajectorySample } from '../types'

type Props = {
  referenceBody: CelestialBody
  trajectories: TrajectorySample[]
  currentPositions: RenderedBodyPosition[]
}

function createBodySphere(body: CelestialBody, position: THREE.Vector3) {
  const geometry = new THREE.SphereGeometry(body.kind === 'star' ? 0.12 : body.kind === 'planet' ? 0.08 : 0.04, 16, 16)
  const material = new THREE.MeshBasicMaterial({ color: body.color })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.copy(position)
  return mesh
}

export function TrajectoryCanvas3D({ referenceBody, trajectories, currentPositions }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const meshesRef = useRef<THREE.Object3D[]>([])

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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trajectories, currentPositions, referenceBody.id])

  return <div ref={containerRef} className="viz-canvas canvas-mode" />
}
