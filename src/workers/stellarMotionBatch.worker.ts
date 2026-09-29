/// <reference lib="webworker" />
import capacity from "../data/gaiaCapacity.json";
import {
  decodeGaiaManifest,
  gaiaHash,
  streamGaiaChunks,
  type GaiaManifest,
} from "../lib/gaiaChunks";
import { readBounded } from "../lib/stateTiles";
import { createGaiaDisplayPointWriter } from "../lib/gaiaProjection";
import { planGaiaCollection } from "../lib/gaiaCollection";
import { readScientificSourceFile } from "../lib/scientificSourceFile";
import {
  compactStellarMotionTileReceipt,
  STELLAR_MOTION_ROW_STATUS_CODE,
} from "../lib/stellarMotionResultStore";
import {
  GAIA_ZERO_RADIAL_MOTION_POLICY,
  loadStellarMotionTile,
  prepareStellarMotionManifest,
  type PreparedStellarMotionManifest,
  type StellarMotionTileReceipt,
} from "../lib/stellarMotion";
import { validateGaiaLoadRequest } from "./gaia.protocol";
import {
  STELLAR_MOTION_UPLOAD_MAX_ROWS,
  STELLAR_MOTION_UPLOAD_SLOTS,
  type StellarMotionBatchRequest,
  type StellarMotionBatchResponse,
  type StellarMotionBatchRunRequest,
} from "./stellarMotionBatch.protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (
  message: StellarMotionBatchResponse,
  transfer: Transferable[] = [],
) => scope.postMessage(message, transfer);
let active = false;
const pendingAcknowledgements = new Map<
  number,
  { rows: number; finish: (error?: unknown) => void }
>();
const acknowledgementSlotWaiters = new Set<() => void>();
let pendingAcknowledgementRows = 0;

type MotionRegion = {
  manifest: GaiaManifest;
  manifestBytes: Uint8Array<ArrayBuffer>;
  manifestSha256: string;
  preparedManifest?: PreparedStellarMotionManifest;
  originalManifestJson: string;
  source: { kind: "remote-url"; url: string } | { kind: "local-files" };
  baseUrl: string;
  localFiles?: Map<string, File>;
};

function notifyAcknowledgementSlotWaiters() {
  for (const wake of [...acknowledgementSlotWaiters]) wake();
}

async function reserveAcknowledgementSlot(
  sequence: number,
  rows: number,
  waitSignal: AbortSignal,
  lifetimeSignal: AbortSignal,
) {
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    pendingAcknowledgements.has(sequence) ||
    !Number.isSafeInteger(rows) ||
    rows < 1 ||
    rows > STELLAR_MOTION_UPLOAD_MAX_ROWS
  ) {
    throw new Error(
      "Gaia motion chunk exceeds the upload acknowledgement row budget",
    );
  }
  while (
    pendingAcknowledgements.size >= STELLAR_MOTION_UPLOAD_SLOTS ||
    pendingAcknowledgementRows + rows > STELLAR_MOTION_UPLOAD_MAX_ROWS
  ) {
    waitSignal.throwIfAborted();
    lifetimeSignal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        acknowledgementSlotWaiters.delete(wake);
        waitSignal.removeEventListener("abort", abort);
        lifetimeSignal.removeEventListener("abort", abort);
        if (error !== undefined) reject(error);
        else resolve();
      };
      const wake = () => finish();
      const abort = () =>
        finish(
          waitSignal.reason ??
            lifetimeSignal.reason ??
            new DOMException("Gaia chart upload cancelled", "AbortError"),
        );
      acknowledgementSlotWaiters.add(wake);
      waitSignal.addEventListener("abort", abort, { once: true });
      lifetimeSignal.addEventListener("abort", abort, { once: true });
      if (
        pendingAcknowledgements.size < STELLAR_MOTION_UPLOAD_SLOTS &&
        pendingAcknowledgementRows + rows <= STELLAR_MOTION_UPLOAD_MAX_ROWS
      )
        wake();
      if (waitSignal.aborted || lifetimeSignal.aborted) abort();
    });
  }
  waitSignal.throwIfAborted();
  lifetimeSignal.throwIfAborted();
  let resolveAcknowledgement!: () => void,
    rejectAcknowledgement!: (error: unknown) => void,
    timer: ReturnType<typeof setTimeout> | undefined,
    settled = false;
  const acknowledgement = new Promise<void>((resolve, reject) => {
    resolveAcknowledgement = resolve;
    rejectAcknowledgement = reject;
  });
  const finish = (error?: unknown) => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    lifetimeSignal.removeEventListener("abort", abort);
    pendingAcknowledgements.delete(sequence);
    pendingAcknowledgementRows -= rows;
    notifyAcknowledgementSlotWaiters();
    if (error !== undefined) rejectAcknowledgement(error);
    else resolveAcknowledgement();
  };
  const abort = () =>
    finish(
      lifetimeSignal.reason ??
        new DOMException("Gaia chart upload cancelled", "AbortError"),
    );
  const markPosted = () => {
    if (settled || timer !== undefined) return;
    timer = setTimeout(
      () =>
        finish(
          new Error(
            "Gaia page did not acknowledge a verified chunk within 30 seconds",
          ),
        ),
      30_000,
    );
  };
  pendingAcknowledgements.set(sequence, { rows, finish });
  pendingAcknowledgementRows += rows;
  lifetimeSignal.addEventListener("abort", abort, { once: true });
  if (lifetimeSignal.aborted) abort();
  return { acknowledgement, finish, markPosted };
}

async function readManifestUrls(
  urls: string[],
  signal: AbortSignal,
): Promise<MotionRegion[]> {
  const normalized = validateGaiaLoadRequest(
    urls.length === 1 ? { manifestUrl: urls[0] } : { manifestUrls: urls },
  );
  const validUrls =
    normalized.manifestUrls ??
    (normalized.manifestUrl ? [normalized.manifestUrl] : []);
  if (validUrls.length !== urls.length)
    throw new Error("Gaia manifest URL collection was not normalized");
  const regions: MotionRegion[] = [];
  let totalManifestBytes = 0;
  for (const manifestUrl of validUrls) {
    signal.throwIfAborted();
    const response = await fetch(manifestUrl, { signal, redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Gaia manifest HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(
      await readBounded(
        response,
        "application/json",
        capacity.maxManifestBytes,
        signal,
      ),
    );
    totalManifestBytes += bytes.byteLength;
    if (totalManifestBytes > capacity.maxCollectionManifestBytes)
      throw new Error(
        "Gaia collection manifests exceed their aggregate byte budget",
      );
    const manifest = decodeGaiaManifest(bytes);
    const preparedManifest = await prepareStellarMotionManifest(bytes, signal);
    regions.push({
      manifest,
      manifestBytes: bytes,
      manifestSha256: preparedManifest.manifestSha256,
      preparedManifest,
      originalManifestJson: new TextDecoder("utf-8", { fatal: true }).decode(
        bytes,
      ),
      source: { kind: "remote-url", url: manifestUrl },
      baseUrl: new URL(".", manifestUrl).href,
    });
  }
  return regions;
}

async function readLocalManifest(
  files: File[],
  signal: AbortSignal,
): Promise<MotionRegion[]> {
  if (
    files.length < 1 ||
    files.length > capacity.maxChunks + 1 ||
    files.some((file) => !(file instanceof File))
  ) {
    throw new Error(
      "Select one original manifest.json and its bounded Gaia chunk files",
    );
  }
  const manifests = files.filter((file) => file.name === "manifest.json");
  if (manifests.length !== 1)
    throw new Error(
      "Local propagation needs exactly one original manifest.json",
    );
  const manifestFile = manifests[0];
  if (manifestFile.size < 1 || manifestFile.size > capacity.maxManifestBytes)
    throw new Error("Gaia manifest size exceeds budget");
  const manifestBytes = new Uint8Array(
    await readScientificSourceFile(
      manifestFile,
      signal,
      capacity.maxManifestBytes,
    ),
  );
  const manifest = decodeGaiaManifest(manifestBytes);
  const preparedManifest = await prepareStellarMotionManifest(
    manifestBytes,
    signal,
  );
  const chunkFiles = files.filter((file) => file !== manifestFile),
    filesByPath = new Map<string, File>();
  if (chunkFiles.length !== manifest.chunks.length)
    throw new Error(
      "Select every original Gaia chunk declared by this manifest",
    );
  for (const file of chunkFiles) {
    if (
      file.size < 1 ||
      file.size > capacity.maxChunkBytes ||
      !/^r\d+-d\d+\.json$/.test(file.name) ||
      filesByPath.has(file.name)
    ) {
      throw new Error(
        "Selected Gaia chunk names must be unique, bounded original spatial-bin files",
      );
    }
    filesByPath.set(file.name, file);
  }
  for (const descriptor of manifest.chunks) {
    const file = filesByPath.get(descriptor.path);
    if (!file || file.size !== descriptor.bytes)
      throw new Error(
        `Select the original ${descriptor.path} with its manifest-declared size`,
      );
  }
  return [
    {
      manifest,
      manifestBytes,
      manifestSha256: preparedManifest.manifestSha256,
      preparedManifest,
      originalManifestJson: new TextDecoder("utf-8", { fatal: true }).decode(
        manifestBytes,
      ),
      source: { kind: "local-files" },
      baseUrl: "https://local-gaia.invalid/",
      localFiles: filesByPath,
    },
  ];
}

scope.onmessage = (event) => {
  const incoming = event.data as StellarMotionBatchRequest;
  if (incoming?.type === "ack") {
    if (Number.isSafeInteger(incoming.sequence))
      pendingAcknowledgements.get(incoming.sequence)?.finish();
    return;
  }
  if (active) return;
  active = true;
  void runBatch(incoming as StellarMotionBatchRunRequest);
};

async function runBatch(request: StellarMotionBatchRunRequest) {
  const controller = new AbortController(),
    rawChunkBytes = new Map<string, Uint8Array>(),
    pendingAcknowledgementTasks = new Set<Promise<void>>();
  try {
    if (
      !request ||
      request.type !== "run" ||
      typeof request.backendBaseUrl !== "string" ||
      !request.backendBaseUrl.trim() ||
      !Number.isFinite(request.targetEpochJulianYearTCB) ||
      Math.abs(request.targetEpochJulianYearTCB - 2016) > 100 ||
      (request.radialVelocityPolicy !== "spectroscopic-as-astrometric" &&
        request.radialVelocityPolicy !== GAIA_ZERO_RADIAL_MOTION_POLICY)
    ) {
      throw new Error("Invalid Gaia motion batch request");
    }
    const hasFiles = request.files !== undefined,
      hasUrls = request.manifestUrls !== undefined;
    if (hasFiles === hasUrls)
      throw new Error("Choose local Gaia files or manifest URLs, not both");
    const regions = hasFiles
      ? await readLocalManifest(request.files!, controller.signal)
      : await readManifestUrls(request.manifestUrls!, controller.signal);
    if (regions.length < 1 || regions.length > capacity.maxCatalogsPerChart)
      throw new Error("Gaia collection exceeds its manifest-count budget");
    const collection = planGaiaCollection(
      regions.map((region) => region.manifest),
    );
    const totalManifestBytes = regions.reduce(
      (sum, region) => sum + region.manifestBytes.byteLength,
      0,
    );
    if (totalManifestBytes > capacity.maxCollectionManifestBytes)
      throw new Error(
        "Gaia collection manifests exceed their aggregate byte budget",
      );
    const chunks = regions.flatMap((region, manifestIndex) =>
      region.manifest.chunks.map(({ path, sha256, bytes, rows }) => ({
        manifestIndex,
        manifestSha256: region.manifestSha256,
        path,
        sha256,
        bytes,
        rows,
      })),
    );
    const collectionSha256 = await gaiaHash(
      new TextEncoder().encode(
        JSON.stringify(
          regions.map((region, manifestIndex) => ({
            manifestIndex,
            manifestSha256: region.manifestSha256,
          })),
        ),
      ) as Uint8Array<ArrayBuffer>,
    );
    post({
      type: "start",
      plan: {
        collectionSha256,
        manifestCount: regions.length,
        targetEpochJulianYearTCB: request.targetEpochJulianYearTCB,
        inputRows: collection.declaredRows,
        selectedBytes: collection.selectedBytes,
        totalManifestBytes,
        projection: collection.projection,
        manifests: regions.map((region) => ({
          manifestSha256: region.manifestSha256,
          originalManifestJson: region.originalManifestJson,
          source: region.source,
          rows: region.manifest.rows,
          chunkCount: region.manifest.chunks.length,
        })),
        chunks,
      },
    });

    let sequence = 0,
      verifiedRows = 0,
      verifiedChunks = 0,
      uniqueSourceRows = 0,
      duplicateSourceRows = 0;
    let orderedCommit = Promise.resolve();
    const seenSourceIds = new Set<bigint>();
    const projection = collection.projection;
    const writePoint = createGaiaDisplayPointWriter(
      projection.centerRaDeg,
      projection.centerDecDeg,
      projection.radiusDeg,
      capacity.maxProjectionRadiusDegrees,
    );
    const centerRa = (projection.centerRaDeg * Math.PI) / 180,
      centerDec = (projection.centerDecDeg * Math.PI) / 180;
    const center = [
      Math.cos(centerDec) * Math.cos(centerRa),
      Math.cos(centerDec) * Math.sin(centerRa),
      Math.sin(centerDec),
    ];

    for (
      let manifestIndex = 0;
      manifestIndex < regions.length;
      manifestIndex++
    ) {
      const region = regions[manifestIndex],
        manifest = region.manifest;
      const preparedManifest = region.preparedManifest;
      if (!preparedManifest)
        throw new Error(
          `Prepared Gaia manifest unavailable for region ${manifestIndex + 1}`,
        );
      const manifestSelectedBytes = manifest.chunks.reduce(
        (sum, chunk) => sum + chunk.bytes,
        0,
      );
      let summary: Awaited<ReturnType<typeof streamGaiaChunks>>;
      try {
        summary = await streamGaiaChunks({
          manifest,
          baseUrl: region.baseUrl,
          signal: controller.signal,
          region: {
            raStartDeg: 0,
            raEndDeg: 360,
            decMinDeg: -90,
            decMaxDeg: 90,
            epochJulianYear: 2016,
          },
          readChunk: async (path, expectedBytes, signal) => {
            signal.throwIfAborted();
            let bytes: Uint8Array<ArrayBuffer>;
            if (region.localFiles) {
              const file = region.localFiles.get(path);
              if (!file || file.size !== expectedBytes)
                throw new Error(
                  `Unexpected local Gaia chunk requested: ${path}`,
                );
              const buffer = await file.arrayBuffer();
              signal.throwIfAborted();
              if (buffer.byteLength !== expectedBytes)
                throw new Error(
                  `Gaia chunk size changed while reading: ${path}`,
                );
              bytes = new Uint8Array(buffer);
            } else {
              const response = await fetch(new URL(path, region.baseUrl), {
                signal,
                redirect: "error",
              });
              if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                throw new Error(`Gaia chunk HTTP ${response.status}`);
              }
              bytes = new Uint8Array(
                await readBounded(
                  response,
                  "application/json",
                  expectedBytes,
                  signal,
                ),
              );
            }
            rawChunkBytes.set(path, bytes);
            return bytes;
          },
          includeDirections: false,
          retainSourceIdStrings: false,
          // Decode/source-ID discovery stays ordered; two backend requests can
          // propagate separate chunks while their results commit in source order.
          concurrency: 2,
          consumerConcurrency: 2,
          maxInFlightBytes: 64 << 20,
          maxInFlightRows: 60_000,
          maxTotalBytes: Math.max(1, manifestSelectedBytes),
          onChunk: async (chunk, signal) => {
            // Retain G magnitude and RV availability in compact typed columns
            // after releasing the validated source-object graph.
            const gMagnitudes = new Float64Array(chunk.sources.length);
            const radialVelocityAvailability = new Uint8Array(chunk.sources.length);
            for (let rowIndex = 0; rowIndex < chunk.sources.length; rowIndex++) {
              gMagnitudes[rowIndex] = chunk.sources[rowIndex].phot_g_mean_mag;
              radialVelocityAvailability[rowIndex] =
                typeof chunk.sources[rowIndex].radial_velocity === "number" &&
                Number.isFinite(chunk.sources[rowIndex].radial_velocity)
                  ? 1
                  : 0;
            }
            chunk.sources.length = 0;
            const descriptor = chunk.descriptor,
              chunkSequence = ++sequence,
              previousCommit = orderedCommit;
            let releaseCommit!: () => void;
            orderedCommit = new Promise<void>((resolve) => {
              releaseCommit = resolve;
            });
            let releaseReservation: ((error?: unknown) => void) | undefined,
              markReservationPosted: (() => void) | undefined;
            try {
              const reservation = await reserveAcknowledgementSlot(
                chunkSequence,
                descriptor.rows,
                signal,
                controller.signal,
              );
              releaseReservation = reservation.finish;
              markReservationPosted = reservation.markPosted;
              const trackedAcknowledgement = reservation.acknowledgement.catch(
                (error) => {
                  if (!controller.signal.aborted) controller.abort(error);
                },
              );
              pendingAcknowledgementTasks.add(trackedAcknowledgement);
              void trackedAcknowledgement.then(() =>
                pendingAcknowledgementTasks.delete(trackedAcknowledgement),
              );
              signal.throwIfAborted();
              const chunkBytes = rawChunkBytes.get(descriptor.path);
              if (!chunkBytes)
                throw new Error(
                  `Verified source bytes unavailable for ${descriptor.path}`,
                );
              let receipt: StellarMotionTileReceipt;
              try {
                receipt = await loadStellarMotionTile(
                  request.backendBaseUrl,
                  {
                    manifestBytes: region.manifestBytes,
                    manifestSha256: region.manifestSha256,
                    preparedManifest,
                    descriptor,
                    chunkBytes: chunkBytes.buffer instanceof ArrayBuffer ? chunkBytes as Uint8Array<ArrayBuffer> : new Uint8Array(chunkBytes),
                    sourceIds: chunk.sourceIds,
                    radialVelocityAvailability,
                    targetEpochJulianYearTCB: request.targetEpochJulianYearTCB,
                    radialVelocityPolicy: request.radialVelocityPolicy,
                  },
                  signal,
                );
              } finally {
                rawChunkBytes.delete(descriptor.path);
              }
              signal.throwIfAborted();
              if (
                receipt.chunkPath !== descriptor.path ||
                receipt.chunkSha256 !== descriptor.sha256 ||
                receipt.manifestSha256 !== region.manifestSha256 ||
                receipt.motion.inputRows !== descriptor.rows ||
                receipt.motion.rows.length !== descriptor.rows
              ) {
                throw new Error(
                  `Gaia motion receipt does not match ${descriptor.path}`,
                );
              }
              const compacted = compactStellarMotionTileReceipt(
                receipt,
                chunk.sourceIds,
              );
              receipt.motion.rows = [];
              // Backend propagation may finish out of order. Deduplication,
              // projection and publication remain serialized in manifest order.
              await previousCommit;
              signal.throwIfAborted();
              const plotRowOrdinals = new Uint32Array(
                  receipt.motion.propagatedRows,
                ),
                points = new Float32Array(receipt.motion.propagatedRows * 3),
                direction = new Float64Array(3);
              let plotted = 0,
                chunkDuplicates = 0,
                chunkPropagated = 0,
                chunkMissing = 0,
                chunkRejected = 0,
                chunkZeroRadialMotion = 0;
              for (
                let rowIndex = 0;
                rowIndex < compacted.rows.sourceIds.length;
                rowIndex++
              ) {
                const sourceId = compacted.rows.sourceIds[rowIndex];
                const priorSeenSourceIdCount = seenSourceIds.size;
                seenSourceIds.add(sourceId);
                if (seenSourceIds.size === priorSeenSourceIdCount) {
                  chunkDuplicates++;
                  continue;
                }
                uniqueSourceRows++;
                const status = compacted.rows.statuses[rowIndex];
                if (status === STELLAR_MOTION_ROW_STATUS_CODE.missing) {
                  chunkMissing++;
                  continue;
                }
                if (status === STELLAR_MOTION_ROW_STATUS_CODE.rejected) {
                  chunkRejected++;
                  continue;
                }
                if (status !== STELLAR_MOTION_ROW_STATUS_CODE.propagated)
                  throw new Error(
                    `Propagated Gaia row has an invalid status at ${rowIndex}`,
                  );
                chunkPropagated++;
                if (
                  compacted.rows.zeroRadialMotionAssumptions[rowIndex] === 1
                )
                  chunkZeroRadialMotion++;
                const stateIndex = compacted.rows.stateIndexes[rowIndex];
                if (stateIndex === 0)
                  throw new Error(
                    `Propagated Gaia row has no compact state at ${rowIndex}`,
                  );
                const stateOffset = (stateIndex - 1) * 6,
                  ra = (compacted.rows.states[stateOffset] * Math.PI) / 180,
                  dec =
                    (compacted.rows.states[stateOffset + 1] * Math.PI) / 180,
                  cos = Math.cos(dec);
                direction[0] = cos * Math.cos(ra);
                direction[1] = cos * Math.sin(ra);
                direction[2] = Math.sin(dec);
                const crossX =
                  direction[1] * center[2] - direction[2] * center[1];
                const crossY =
                  direction[2] * center[0] - direction[0] * center[2];
                const crossZ =
                  direction[0] * center[1] - direction[1] * center[0];
                const dot =
                  direction[0] * center[0] +
                  direction[1] * center[1] +
                  direction[2] * center[2];
                const distance =
                  (Math.atan2(Math.hypot(crossX, crossY, crossZ), dot) * 180) /
                  Math.PI;
                if (distance > projection.radiusDeg) continue;
                writePoint(
                  direction,
                  0,
                  gMagnitudes[rowIndex],
                  points,
                  plotted * 3,
                );
                plotRowOrdinals[plotted] = rowIndex;
                plotted++;
              }
              duplicateSourceRows += chunkDuplicates;
              const display = new Float32Array(points.subarray(0, plotted * 3));
              const plottedRowOrdinals = plotRowOrdinals.slice(0, plotted);
              post(
                {
                  type: "chunk",
                  sequence: chunkSequence,
                  collectionSha256,
                  manifestIndex,
                  duplicateSourceRows: chunkDuplicates,
                  outcomes: {
                    propagated: chunkPropagated,
                    missing: chunkMissing,
                    rejected: chunkRejected,
                    zeroRadialMotion: chunkZeroRadialMotion,
                  },
                  receipt: compacted.receipt,
                  rows: compacted.rows,
                  display,
                  plotRowOrdinals: plottedRowOrdinals,
                },
                [
                  compacted.rows.sourceIds.buffer,
                  compacted.rows.statuses.buffer,
                  compacted.rows.zeroRadialMotionAssumptions.buffer,
                  compacted.rows.reasonCodes.buffer,
                  compacted.rows.stateIndexes.buffer,
                  compacted.rows.states.buffer,
                  display.buffer,
                  plottedRowOrdinals.buffer,
                ],
              );
              markReservationPosted?.();
            } catch (error) {
              releaseReservation?.(error);
              if (!controller.signal.aborted) controller.abort(error);
              throw error;
            } finally {
              releaseCommit();
            }
          },
        });
      } finally {
        rawChunkBytes.clear();
        region.preparedManifest = undefined;
      }
      if (
        summary.verifiedChunks !== manifest.chunks.length ||
        summary.verifiedRows !== manifest.rows ||
        summary.selection.allManifestChunksVerified !== true
      ) {
        throw new Error(
          `Gaia motion collection did not verify every chunk in manifest ${manifestIndex + 1}`,
        );
      }
      verifiedChunks += summary.verifiedChunks;
      verifiedRows += summary.verifiedRows;
    }
    await Promise.all(pendingAcknowledgementTasks);
    controller.signal.throwIfAborted();
    if (
      verifiedChunks !== collection.chunkCount ||
      verifiedRows !== collection.declaredRows ||
      uniqueSourceRows + duplicateSourceRows !== verifiedRows ||
      sequence !== verifiedChunks
    ) {
      throw new Error(
        "Gaia motion collection did not reconcile with its aggregate manifest and row budgets",
      );
    }
    controller.signal.throwIfAborted();
    post({
      type: "done",
      collectionSha256,
      verifiedChunks,
      verifiedRows,
      uniqueSourceRows,
      duplicateSourceRows,
    });
  } catch (error) {
    if (!controller.signal.aborted) controller.abort(error);
    rawChunkBytes.clear();
    post({ type: "error", error: String(error) });
  } finally {
    pendingAcknowledgements.clear();
    pendingAcknowledgementRows = 0;
    notifyAcknowledgementSlotWaiters();
    active = false;
  }
}
