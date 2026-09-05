import type { BackendTrajectoryResult, loadBackendTrajectories } from './backendTrajectories'

export type BackendTrajectoryJob = Omit<Parameters<typeof loadBackendTrajectories>[0], 'signal' | 'fetcher' | 'onProgress'> & { requestId: number }
type Run = (job: BackendTrajectoryJob, signal: AbortSignal, progress: (value: number) => void) => Promise<BackendTrajectoryResult>

/** One running job and one latest desired epoch. Clock ticks cannot starve a
 * slow network by repeatedly aborting useful work; scope changes dispose it. */
export function createBackendTrajectoryQueue(run: Run, callbacks: {
  progress: (requestId: number, value: number) => void
  result: (requestId: number, result: BackendTrajectoryResult) => void
  error: (requestId: number, error: unknown) => void
}) {
  let pending: BackendTrajectoryJob | null = null
  let active: AbortController | null = null
  let running = false, disposed = false
  async function drain() {
    if (running || disposed) return
    running = true
    try {
      while (pending && !disposed) {
        const job = pending; pending = null
        const controller = new AbortController(); active = controller
        try {
          const result = await run(job, controller.signal, value => { if (!disposed && !controller.signal.aborted) callbacks.progress(job.requestId, value) })
          if (!disposed && !controller.signal.aborted) callbacks.result(job.requestId, result)
        } catch (error) {
          if (!disposed && !controller.signal.aborted) callbacks.error(job.requestId, error)
        } finally { active = null }
      }
    } finally { running = false }
  }
  return {
    submit(job: BackendTrajectoryJob) { if (!disposed) { pending = job; void drain() } },
    dispose() { disposed = true; pending = null; active?.abort() },
  }
}
