import type {
  CompactStellarMotionRows,
  CompactStellarMotionTileReceipt,
} from "../lib/stellarMotionResultStore";
import type { StellarMotionRadialVelocityPolicy } from "../lib/stellarMotion";

export const STELLAR_MOTION_UPLOAD_SLOTS = 2;
export const STELLAR_MOTION_UPLOAD_MAX_ROWS = 60_000;

export type StellarMotionBatchRunRequest = {
  type: "run";
  files?: File[];
  manifestUrls?: string[];
  backendBaseUrl: string;
  targetEpochJulianYearTCB: number;
  radialVelocityPolicy: StellarMotionRadialVelocityPolicy;
};
export type StellarMotionBatchRequest =
  StellarMotionBatchRunRequest | { type: "ack"; sequence: number };

export type StellarMotionBatchPlan = {
  collectionSha256: string;
  manifestCount: number;
  targetEpochJulianYearTCB: number;
  inputRows: number;
  selectedBytes: number;
  totalManifestBytes: number;
  projection: { centerRaDeg: number; centerDecDeg: number; radiusDeg: number };
  manifests: Array<{
    manifestSha256: string;
    originalManifestJson: string;
    source: { kind: "remote-url"; url: string } | { kind: "local-files" };
    rows: number;
    chunkCount: number;
  }>;
  chunks: Array<{
    manifestIndex: number;
    manifestSha256: string;
    path: string;
    sha256: string;
    bytes: number;
    rows: number;
  }>;
};

export type StellarMotionBatchResponse =
  | { type: "start"; plan: StellarMotionBatchPlan }
  | {
      type: "chunk";
      sequence: number;
      collectionSha256: string;
      manifestIndex: number;
      duplicateSourceRows: number;
      outcomes: { propagated: number; missing: number; rejected: number; zeroRadialMotion: number };
      receipt: CompactStellarMotionTileReceipt;
      rows: CompactStellarMotionRows;
      display: Float32Array;
      plotRowOrdinals: Uint32Array;
    }
  | {
      type: "done";
      collectionSha256: string;
      verifiedChunks: number;
      verifiedRows: number;
      uniqueSourceRows: number;
      duplicateSourceRows: number;
    }
  | { type: "error"; error: string };
