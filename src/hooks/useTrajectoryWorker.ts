import { useEffect, useRef, useState } from 'react'
import type { CelestialBody, TrajectoryFrameData, TrajectoryWorkerRequest, TrajectoryWorkerResponse } from '../types'

const EMPTY_FRAME: TrajectoryFrameData = {
  currentPositions: [],
  trajectories: [],
  maxDistance: 0,
}

type Params = {
  bodies: CelestialBody[]
  resolutionBodies: CelestialBody[]
  referenceId: string
  centerJulianDay: number
  historyDays: number
  sampleCount: number
}

export function useTrajectoryWorker(params: Params) {
  const { bodies, resolutionBodies, referenceId, centerJulianDay, historyDays, sampleCount } = params
  const workerRef = useRef<Worker | null>(null)
  const latestRequestId = useRef(0)
  const [frame, setFrame] = useState<TrajectoryFrameData>(EMPTY_FRAME)

  useEffect(() => {
    const worker = new Worker(new URL('../workers/trajectory.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (event: MessageEvent<TrajectoryWorkerResponse>) => {
      const response = event.data

      if (response.type !== 'result' || response.requestId !== latestRequestId.current) {
        return
      }

      setFrame(response.frame)
    }

    workerRef.current = worker

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    const worker = workerRef.current
    if (!worker) {
      return
    }

    const requestId = latestRequestId.current + 1
    latestRequestId.current = requestId

    const request: TrajectoryWorkerRequest = {
      type: 'compute',
      requestId,
      bodies,
      resolutionBodies,
      referenceId,
      centerJulianDay,
      historyDays,
      sampleCount,
    }

    worker.postMessage(request)
  }, [bodies, centerJulianDay, historyDays, referenceId, resolutionBodies, sampleCount])

  return frame
}
