import type { runOccultationExperiment } from '../engine/events/occultationExperiment'
import type { runSpkLimbExperiment } from '../engine/events/spkLimbExperiment'
import type { runStellarLimbExperiment } from '../engine/events/stellarLimbExperiment'
import type { runEllipsoidRayContactExperiment } from '../engine/events/ellipsoidRayContactExperiment'
import type { StellarObserverRequest } from '../lib/stellarObserver'

export type OccultationWorkerRequest =
  | { calculation?: 'contacts'; inputBytes: ArrayBuffer }
  | { calculation: 'limb'; inputBytes: ArrayBuffer }
  | { calculation: 'stellar-limb'; inputBytes: ArrayBuffer; observerResponseBytes: ArrayBuffer; observerRequest: StellarObserverRequest }
  | { calculation: 'ellipsoid-ray-contacts'; inputBytes: ArrayBuffer }

export type StellarLimbReceipt = Awaited<ReturnType<typeof runStellarLimbExperiment>>
export type OccultationWorkerResponse =
  | { type: 'done'; calculation: 'contacts'; receipt: Awaited<ReturnType<typeof runOccultationExperiment>> }
  | { type: 'done'; calculation: 'limb'; receipt: Awaited<ReturnType<typeof runSpkLimbExperiment>> }
  | { type: 'done'; calculation: 'stellar-limb'; receipt: StellarLimbReceipt }
  | { type: 'done'; calculation: 'ellipsoid-ray-contacts'; receipt: Awaited<ReturnType<typeof runEllipsoidRayContactExperiment>> }
  | { type: 'error'; error: string }
