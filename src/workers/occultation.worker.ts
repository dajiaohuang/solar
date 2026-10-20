/// <reference lib="webworker" />
import gmText from '../data/gm_de440.tpc?raw'
import pckText from '../data/pck00011.tpc?raw'
import { fetchDe440Bytes } from '../lib/fetchDe440Bytes'
import { parseOccultationInput, runOccultationExperiment } from '../engine/events/occultationExperiment'
import { parseSpkLimbInput, runSpkLimbExperiment } from '../engine/events/spkLimbExperiment'
import { parseStellarLimbInput, runStellarLimbExperiment } from '../engine/events/stellarLimbExperiment'
import { runEllipsoidRayContactExperiment } from '../engine/events/ellipsoidRayContactExperiment'
import { parseEllipsoidRayContactInput } from '../lib/ellipsoidRayContactInput'
import { validateStellarObserverRequest } from '../lib/stellarObserver'
import type { OccultationWorkerRequest, OccultationWorkerResponse } from './occultation.protocol'

const scope = self as DedicatedWorkerGlobalScope
let started = false
const send = (message: OccultationWorkerResponse) => scope.postMessage(message)
scope.onmessage = (event: MessageEvent<OccultationWorkerRequest>) => {
  if (started) return
  started = true
  void (async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const data = event.data, { inputBytes } = data
      const calculation = data.calculation ?? 'contacts'
      if (!(inputBytes instanceof ArrayBuffer)) throw new Error('SPK geometry input bytes required')
      if (calculation !== 'contacts' && calculation !== 'limb' && calculation !== 'stellar-limb' && calculation !== 'ellipsoid-ray-contacts') throw new Error('Unsupported SPK geometry calculation')
      if (calculation === 'limb') parseSpkLimbInput(inputBytes)
      else if (calculation === 'ellipsoid-ray-contacts') parseEllipsoidRayContactInput(inputBytes)
      else if (data.calculation === 'stellar-limb') {
        parseStellarLimbInput(inputBytes)
        if (!(data.observerResponseBytes instanceof ArrayBuffer) || !data.observerResponseBytes.byteLength || data.observerResponseBytes.byteLength > 14*1024*1024) throw new Error('Observer receipt exceeds the 14 MiB budget')
        validateStellarObserverRequest(data.observerRequest)
      }
      else parseOccultationInput(inputBytes)
      const spkBytes = await fetchDe440Bytes(controller.signal)
      const common = { inputBytes, spkBytes, takeSpkBytesOwnership: true, pckBytes: new TextEncoder().encode(pckText).buffer, gmText, signal: controller.signal }
      if (data.calculation === 'stellar-limb') send({ type: 'done', calculation: 'stellar-limb', receipt: await runStellarLimbExperiment({ ...common, observerResponseBytes: data.observerResponseBytes, observerRequest: data.observerRequest }) })
      else if (calculation === 'ellipsoid-ray-contacts') send({ type: 'done', calculation: 'ellipsoid-ray-contacts', receipt: await runEllipsoidRayContactExperiment(common) })
      else if (calculation === 'limb') send({ type: 'done', calculation: 'limb', receipt: await runSpkLimbExperiment(common) })
      else send({ type: 'done', calculation: 'contacts', receipt: await runOccultationExperiment(common) })
    } catch (error) { send({ type: 'error', error: error instanceof Error ? error.message : String(error) }) }
    finally { clearTimeout(timer) }
  })()
}
