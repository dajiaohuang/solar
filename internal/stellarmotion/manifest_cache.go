package stellarmotion

import (
	"container/list"
	"context"
	"crypto/sha256"
	"sync"
)

const (
	gaiaMotionManifestCacheEntries = 4
	gaiaMotionManifestCacheBytes   = 8 << 20
)

// GaiaMotionManifestCache retains only validated, immutable manifest parses.
// Its byte limit is conservative admission accounting, not a measurement of
// Go heap use: it charges raw input bytes plus fixed allowances for parsed
// columns, chunk descriptors, and map/list storage.
type GaiaMotionManifestCache struct {
	mu              sync.Mutex
	items           map[[sha256.Size]byte]*list.Element
	order           *list.List
	residentBytes   int64
	hits            uint64
	misses          uint64
	evictions       uint64
	duplicateParses uint64
}

type gaiaMotionManifestCacheEntry struct {
	hash        [sha256.Size]byte
	manifest    gaiaMotionManifest
	descriptors map[string]gaiaMotionDescriptor
	weight      int64
}

func NewGaiaMotionManifestCache() *GaiaMotionManifestCache {
	return &GaiaMotionManifestCache{items: make(map[[sha256.Size]byte]*list.Element), order: list.New()}
}

// PropagateVerifiedChunk reuses a parsed manifest for repeated tiles while
// retaining per-request chunk hash, schema, and source validation.
func (c *GaiaMotionManifestCache) PropagateVerifiedChunk(ctx context.Context, manifestBytes []byte, chunkPath string, chunkBytes []byte, targetYearTCB float64, rvPolicy string) (*GaiaChunkMotionResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if c == nil || len(manifestBytes) == 0 || len(manifestBytes) > maxGaiaMotionManifestBytes {
		return PropagateVerifiedChunk(ctx, manifestBytes, chunkPath, chunkBytes, targetYearTCB, rvPolicy)
	}

	hash := sha256.Sum256(manifestBytes)
	c.mu.Lock()
	if element := c.items[hash]; element != nil {
		c.hits++
		c.order.MoveToFront(element)
		entry := element.Value.(*gaiaMotionManifestCacheEntry)
		c.mu.Unlock()
		return propagateVerifiedGaiaMotionChunk(ctx, entry.manifest, entry.descriptors, hash, chunkPath, chunkBytes, targetYearTCB, rvPolicy)
	}
	c.misses++
	c.mu.Unlock()

	manifest, descriptors, err := verifyGaiaMotionManifest(manifestBytes)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	entry := &gaiaMotionManifestCacheEntry{
		hash:        hash,
		manifest:    manifest,
		descriptors: descriptors,
		weight:      estimateGaiaMotionManifestWeight(manifestBytes, manifest),
	}

	if entry.weight <= gaiaMotionManifestCacheBytes {
		c.mu.Lock()
		if c.items == nil {
			c.items = make(map[[sha256.Size]byte]*list.Element)
		}
		if c.order == nil {
			c.order = list.New()
		}
		if existing := c.items[hash]; existing != nil {
			// At most two requests can be in flight through the HTTP admission
			// gate; this second lookup avoids retaining duplicate concurrent parses.
			c.duplicateParses++
			c.order.MoveToFront(existing)
			entry = existing.Value.(*gaiaMotionManifestCacheEntry)
		} else {
			for c.order.Len() >= gaiaMotionManifestCacheEntries || c.residentBytes+entry.weight > gaiaMotionManifestCacheBytes {
				c.evictOldestLocked()
			}
			c.items[hash] = c.order.PushFront(entry)
			c.residentBytes += entry.weight
		}
		c.mu.Unlock()
	}

	return propagateVerifiedGaiaMotionChunk(ctx, entry.manifest, entry.descriptors, hash, chunkPath, chunkBytes, targetYearTCB, rvPolicy)
}

// Stats returns process-local cache evidence for focused benchmarks.
func (c *GaiaMotionManifestCache) Stats() map[string]uint64 {
	if c == nil {
		return map[string]uint64{}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return map[string]uint64{
		"items":            uint64(len(c.items)),
		"residentBytes":    uint64(c.residentBytes),
		"maxResidentBytes": gaiaMotionManifestCacheBytes,
		"maxItems":         gaiaMotionManifestCacheEntries,
		"cacheHits":        c.hits,
		"cacheMisses":      c.misses,
		"evictions":        c.evictions,
		"duplicateParses":  c.duplicateParses,
	}
}

func (c *GaiaMotionManifestCache) evictOldestLocked() {
	oldest := c.order.Back()
	if oldest == nil {
		return
	}
	entry := oldest.Value.(*gaiaMotionManifestCacheEntry)
	delete(c.items, entry.hash)
	c.residentBytes -= entry.weight
	c.order.Remove(oldest)
	c.evictions++
}

func estimateGaiaMotionManifestWeight(raw []byte, manifest gaiaMotionManifest) int64 {
	// 512 bytes per descriptor intentionally overcounts typical map and slice
	// storage while staying bounded by the validated chunk-count limit.
	weight := int64(len(raw)) + 512 + int64(len(manifest.Columns))*32 + int64(len(manifest.Chunks))*512
	for _, descriptor := range manifest.Chunks {
		weight += int64(len(descriptor.Path) + len(descriptor.SHA256))
	}
	if weight < 0 {
		return gaiaMotionManifestCacheBytes + 1
	}
	return weight
}
