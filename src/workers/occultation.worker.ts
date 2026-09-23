/// <reference lib="webworker" />
import gmText from '../data/gm_de440.tpc?raw'
import pckText from '../data/pck00011.tpc?raw'
import { DE440_DYNAMICS_SOURCE } from '../engine/dynamics/de440Dynamics'
import { parseOccultationInput, runOccultationExperiment } from '../engine/events/occultationExperiment'

const scope = self as DedicatedWorkerGlobalScope
let started = false
scope.onmessage = (event: MessageEvent<{ inputBytes: ArrayBuffer }>) => {
  if (started) return
  started = true
  void (async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const { inputBytes } = event.data
      parseOccultationInput(inputBytes)
      const response = await fetch(`${import.meta.env.BASE_URL}data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`, { signal: controller.signal })
      if (!response.ok || !response.body) throw new Error(`DE440 source unavailable: HTTP ${response.status}`)
      const bytes = new Uint8Array(DE440_DYNAMICS_SOURCE.bytes), reader = response.body.getReader()
      let offset = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          if (offset+chunk.value.byteLength > bytes.length) throw new Error('Oversized DE440 source')
          bytes.set(chunk.value, offset); offset += chunk.value.byteLength
        }
      } catch (error) { await reader.cancel(); throw error }
      if (offset !== bytes.length) throw new Error('Truncated DE440 source')
      const receipt = await runOccultationExperiment({ inputBytes, spkBytes: bytes.buffer,
        pckBytes: new TextEncoder().encode(pckText).buffer, gmText, signal: controller.signal })
      scope.postMessage({ type: 'done', receipt })
    } catch (error) { scope.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) }) }
    finally { clearTimeout(timer) }
  })()
}
