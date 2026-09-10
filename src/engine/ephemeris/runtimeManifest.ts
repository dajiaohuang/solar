export type RuntimeKernelFile = {
  id: string; path: string; sha256: string; bytes: number; targets: number[];
  startEt: number; endEt: number; source: string; core?: boolean;
  solutionKernelIds?: string[]; dependencyOnly?: boolean; solution?: string;
}

/** The execution index is a projection, never a replacement for the complete
 * source manifest. Preserve order, hashes, centers' solution dependencies and
 * source links; leave verbose acquisition/audit records in the source artifact. */
export function runtimeEphemerisManifest(manifest: { schemaVersion: number; id: string; profile?: string; files: readonly RuntimeKernelFile[] }) {
  return {
    schemaVersion: manifest.schemaVersion, id: manifest.id, profile: manifest.profile,
    files: manifest.files.map(({ id, path, sha256, bytes, targets, startEt, endEt, source, core, solutionKernelIds, dependencyOnly, solution }) => ({
      id, path, sha256, bytes, targets, startEt, endEt, source, core, solutionKernelIds, dependencyOnly, solution,
    })),
  }
}
