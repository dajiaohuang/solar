export type RuntimeKernelFile = {
  id: string; path: string; sha256: string; bytes: number; targets: number[];
  startEt: number; endEt: number; source: string; core?: boolean;
  solutionKernelIds?: string[]; dependencyOnly?: boolean; solution?: string;
  sourceBoundary?: { sourceId: string; sourceSetId?: string; trackingDataCutoff?: string; trackingFitThroughMonth?: string; description?: string };
}

/** The execution index is a projection, never a replacement for the complete
 * source manifest. Preserve order, hashes, center dependencies, source links,
 * and compact source boundaries; leave acquisition/audit records in the source. */
export function runtimeEphemerisManifest(manifest: { schemaVersion: number; id: string; profile?: string; files: readonly RuntimeKernelFile[] }) {
  return {
    schemaVersion: manifest.schemaVersion, id: manifest.id, profile: manifest.profile,
    files: manifest.files.map(({ id, path, sha256, bytes, targets, startEt, endEt, source, core, solutionKernelIds, dependencyOnly, solution, sourceBoundary }) => ({
      id, path, sha256, bytes, targets, startEt, endEt, source, core, solutionKernelIds, dependencyOnly, solution,
      ...(sourceBoundary ? { sourceBoundary } : {}),
    })),
  }
}
