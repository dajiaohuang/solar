import type { AsteroidManifest } from '../types'
import type { CatalogReadEvidence } from './catalogStreaming'

/** Check bounded accounting, not the network or source bytes independently. */
export function checkCatalogReadEvidence(reads: CatalogReadEvidence, manifest: AsteroidManifest) {
  const requireValue = (condition: boolean) => { if (!condition) throw new Error('Invalid catalog application-read accounting') }
  const integer = (value: number) => Number.isSafeInteger(value) && value >= 0
  requireValue(Boolean(reads) && reads.method === 'catalog-application-reads-v1' && Boolean(reads.artifacts))
  const maximumAttempts = 2*(manifest.chunkCount+256)+2
  const maximumBytes = { checksums: 2*1024*1024, index: manifest.totalCount*24, metadata: 8*1024*1024, binary: manifest.chunkSize*64 }
  for (const kind of ['checksums','index','metadata','binary'] as const) {
    const counters = reads.artifacts[kind]
    requireValue(Boolean(counters) && [counters.attempts,counters.completed,counters.failed,counters.completedBytes].every(integer) &&
      counters.attempts <= maximumAttempts && counters.attempts === counters.completed+counters.failed &&
      counters.completedBytes <= counters.completed*maximumBytes[kind])
  }
  requireValue(integer(reads.indexCacheHits) && reads.indexCacheHits <= 1 &&
    integer(reads.indexReusedBytes) && reads.indexReusedBytes === reads.indexCacheHits*manifest.totalCount*24 &&
    integer(reads.binaryCacheHits) && reads.binaryCacheHits <= maximumAttempts && integer(reads.binaryReusedBytes) &&
    reads.binaryReusedBytes <= reads.binaryCacheHits*manifest.chunkSize*64 &&
    (reads.binaryCacheHits === 0 ? reads.binaryReusedBytes === 0 : reads.binaryReusedBytes >= reads.binaryCacheHits*64))
  for (const kind of ['checksums','index'] as const) {
    const counters = reads.artifacts[kind]
    requireValue(counters.attempts === 1-reads.indexCacheHits && counters.completed === counters.attempts && counters.failed === 0)
  }
  requireValue(reads.artifacts.index.completedBytes === (1-reads.indexCacheHits)*manifest.totalCount*24)
}
