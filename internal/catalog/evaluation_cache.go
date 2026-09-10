package catalog

import (
	"container/list"
	"math"
	"sync"
)

const evaluationCacheBytes = 16 << 20

type evaluationKey struct {
	target int
	epoch  uint64
}
type evaluationValue struct {
	state      State
	provenance OperationalProvenance
}
type evaluationEntry struct {
	key   evaluationKey
	value evaluationValue
	bytes int
}

// Owned by one immutable Catalog, so its manifest/solution identity is part
// of the cache namespace. Wire order, tile size and display aliases are not.
// Values contain no request-owned mutable buffers. Missing/error/cancelled
// results are deliberately excluded from the cache and throughput counts.
type evaluationCache struct {
	mu           sync.Mutex
	entries      map[evaluationKey]*list.Element
	order        list.List
	bytes        int
	hits, misses uint64
	closed       bool
}

func (c *evaluationCache) get(target int, jd float64) (evaluationValue, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return evaluationValue{}, false
	}
	entry := c.entries[evaluationKey{target, math.Float64bits(jd)}]
	if entry == nil {
		c.misses++
		return evaluationValue{}, false
	}
	c.hits++
	c.order.MoveToFront(entry)
	return entry.Value.(evaluationEntry).value, true
}

func (c *evaluationCache) put(target int, jd float64, value evaluationValue) {
	key := evaluationKey{target, math.Float64bits(jd)}
	// Conservative fixed Go-object allowance plus variable evidence text.
	size := 384 + len(value.provenance.Source) + len(value.provenance.KernelSHA256) + len(value.provenance.CenterID)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || size > evaluationCacheBytes {
		return
	}
	if entry := c.entries[key]; entry != nil {
		c.order.MoveToFront(entry)
		return
	}
	if c.entries == nil {
		c.entries = make(map[evaluationKey]*list.Element)
	}
	c.entries[key] = c.order.PushFront(evaluationEntry{key, value, size})
	c.bytes += size
	for c.bytes > evaluationCacheBytes {
		last := c.order.Back()
		entry := last.Value.(evaluationEntry)
		delete(c.entries, entry.key)
		c.bytes -= entry.bytes
		c.order.Remove(last)
	}
}

func (c *evaluationCache) close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	c.entries = nil
	c.order.Init()
	c.bytes = 0
}

func (c *Catalog) EvaluationCacheStats() map[string]uint64 {
	c.evaluations.mu.Lock()
	defer c.evaluations.mu.Unlock()
	return map[string]uint64{"hits": c.evaluations.hits, "misses": c.evaluations.misses, "items": uint64(len(c.evaluations.entries)), "residentBytes": uint64(c.evaluations.bytes), "maxResidentBytes": evaluationCacheBytes}
}
