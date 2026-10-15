package catalog

import (
	"container/list"
	"context"
	"errors"
	"math"
	"sync"
)

const evaluationCacheBytes = 16 << 20

var errEvaluationInterrupted = errors.New("catalog state evaluation interrupted")

type evaluationKey struct {
	target int
	epoch  uint64
}
type evaluationFlightKey struct {
	evaluationKey
	scope string
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

type evaluationFlight struct {
	done       chan struct{}
	value      evaluationValue
	found      bool
	err        error
	retryAfter bool
}

// Owned by one immutable Catalog, so its manifest/solution identity is part
// of the cache namespace. Wire order, tile size and display aliases are not.
// Values contain no request-owned mutable buffers. Missing/error/cancelled
// results are deliberately excluded from the cache and throughput counts.
type evaluationCache struct {
	mu           sync.Mutex
	entries      map[evaluationKey]*list.Element
	flights      map[evaluationFlightKey]*evaluationFlight
	order        list.List
	bytes        int
	hits, misses uint64
	coalesced    uint64
	closed       bool
}

func (c *evaluationCache) get(target int, et float64) (evaluationValue, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return evaluationValue{}, false
	}
	entry := c.entries[evaluationKey{target, math.Float64bits(et)}]
	if entry == nil {
		c.misses++
		return evaluationValue{}, false
	}
	c.hits++
	c.order.MoveToFront(entry)
	return entry.Value.(evaluationEntry).value, true
}

// load reuses cached states and coalesces simultaneous work for the same
// immutable catalog target and exact epoch. A canceled builder does not cancel
// its waiters; one live waiter retries with its own request context.
func (c *evaluationCache) load(ctx context.Context, target int, et float64, scope string,
	evaluate func(context.Context) (evaluationValue, bool, error)) (evaluationValue, bool, error) {
	key := evaluationKey{target, math.Float64bits(et)}
	flightKey := evaluationFlightKey{evaluationKey: key, scope: scope}
	for {
		if err := ctx.Err(); err != nil {
			return evaluationValue{}, false, err
		}
		c.mu.Lock()
		if entry := c.entries[key]; entry != nil {
			c.hits++
			c.order.MoveToFront(entry)
			value := entry.Value.(evaluationEntry).value
			c.mu.Unlock()
			if err := ctx.Err(); err != nil {
				return evaluationValue{}, false, err
			}
			return value, true, nil
		}
		c.misses++
		if c.closed {
			c.mu.Unlock()
			return evaluate(ctx)
		}
		flight := c.flights[flightKey]
		leader := flight == nil
		if leader {
			flight = &evaluationFlight{done: make(chan struct{})}
			if c.flights == nil {
				c.flights = make(map[evaluationFlightKey]*evaluationFlight)
			}
			c.flights[flightKey] = flight
		} else {
			c.coalesced++
		}
		c.mu.Unlock()

		if leader {
			return c.buildFlight(ctx, flightKey, target, et, flight, evaluate)
		}

		select {
		case <-ctx.Done():
			return evaluationValue{}, false, ctx.Err()
		case <-flight.done:
		}
		if err := ctx.Err(); err != nil {
			return evaluationValue{}, false, err
		}
		if flight.retryAfter {
			continue
		}
		return flight.value, flight.found, flight.err
	}
}

func (c *evaluationCache) buildFlight(ctx context.Context, key evaluationFlightKey, target int, et float64,
	flight *evaluationFlight, evaluate func(context.Context) (evaluationValue, bool, error)) (value evaluationValue, found bool, err error) {
	finished := false
	defer func() {
		if !finished {
			value, found = evaluationValue{}, false
			if err == nil {
				err = errEvaluationInterrupted
			}
		}
		c.mu.Lock()
		flight.value, flight.found, flight.err = value, found, err
		delete(c.flights, key)
		close(flight.done)
		c.mu.Unlock()
	}()

	value, found, err = evaluate(ctx)
	if cancelled := ctx.Err(); cancelled != nil {
		value, found, err = evaluationValue{}, false, cancelled
		flight.retryAfter = true
	}
	if err == nil && found && ctx.Err() == nil {
		c.put(target, et, value)
	}
	finished = true
	return value, found, err
}

func (c *evaluationCache) put(target int, et float64, value evaluationValue) {
	key := evaluationKey{target, math.Float64bits(et)}
	// Conservative fixed Go-object allowance plus variable evidence text.
	size := 400 + len(value.provenance.Source) + len(value.provenance.KernelSHA256) + len(value.provenance.SourceChainSHA256) + len(value.provenance.CenterID)
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
	return map[string]uint64{"hits": c.evaluations.hits, "misses": c.evaluations.misses, "coalesced": c.evaluations.coalesced, "activeFlights": uint64(len(c.evaluations.flights)), "items": uint64(len(c.evaluations.entries)), "residentBytes": uint64(c.evaluations.bytes), "maxResidentBytes": evaluationCacheBytes}
}
