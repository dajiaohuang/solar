/// <reference lib="webworker" />
import gmText from '../data/gm_de440.tpc?raw'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../engine/dynamics/de440Dynamics'
import { integrateDynamicsExperiment, parseDynamicsInitial } from '../engine/dynamics/experiment'

const scope = self as DedicatedWorkerGlobalScope
let started = false
scope.onmessage = (event: MessageEvent<{ initialBytes: ArrayBuffer; durationSeconds: number; exclusionKm: number }>) => {
  if (started) return
  started = true
  void (async () => {
    try {
      const { initialBytes, durationSeconds, exclusionKm } = event.data
      if (initialBytes.byteLength > 2 * 1024 * 1024 || !Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365 * 86400 || !Number.isFinite(exclusionKm) || exclusionKm < 0) throw new RangeError('Invalid bounded experiment input')
      const input = parseDynamicsInitial(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(initialBytes)))
      const inputHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', initialBytes)), v => v.toString(16).padStart(2, '0')).join('')
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000)
      let bytes: Uint8Array<ArrayBuffer>
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`, { signal: controller.signal })
        if (!response.ok || !response.body) throw new Error(`DE440 source unavailable: HTTP ${response.status}`)
        bytes = new Uint8Array(DE440_DYNAMICS_SOURCE.bytes)
        const reader = response.body.getReader()
        let offset = 0
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            if (offset + chunk.value.byteLength > bytes.length) throw new Error('Oversized DE440 source')
            bytes.set(chunk.value, offset); offset += chunk.value.byteLength
          }
        } catch (error) { await reader.cancel(); throw error }
        if (offset !== bytes.length) throw new Error('Truncated DE440 source')
      } finally { clearTimeout(timer) }
      const dynamics = await createDe440Dynamics({ spkBytes: bytes.buffer, gmText, referenceEpochTdb: input.referenceEpochTdb,
        elapsedRangeSeconds: [Math.min(0, durationSeconds), Math.max(0, durationSeconds)], exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, exclusionKm])) })
      const result = await integrateDynamicsExperiment(dynamics, input.initial, durationSeconds)
      scope.postMessage({ type: 'done', receipt: { schemaVersion: 1, calculation: 'restricted-newtonian-de440-experiment',
        initialFile: { sha256: inputHash, bytes: initialBytes.byteLength, payload: input.payload }, ...result } })
    } catch (error) { scope.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) }) }
  })()
}
