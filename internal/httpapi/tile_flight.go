package httpapi

import (
	"context"
	"errors"
)

type stateTileBuildError struct {
	status        int
	code, message string
}

func (e *stateTileBuildError) Error() string { return e.message }

type stateTileFlight struct {
	done  chan struct{}
	value stateTileCacheValue
	err   error
}

// load joins identical encodes without a goroutine or another encoder slot.
// Callers already hold the server's bounded request admission. Each waiter
// retains its own cancellation; a cancelled leader cannot cancel healthy peers.
func (c *stateTileCache) load(ctx context.Context, key string, build func() (stateTileCacheValue, error)) (stateTileCacheValue, error) {
	if err := ctx.Err(); err != nil {
		return stateTileCacheValue{}, err
	}
	if value, ok := c.get(key); ok {
		return value, ctx.Err()
	}
	for {
		if err := ctx.Err(); err != nil {
			return stateTileCacheValue{}, err
		}
		c.mu.Lock()
		flight := c.flights[key]
		leader := flight == nil
		if leader {
			flight = &stateTileFlight{done: make(chan struct{})}
			c.flights[key] = flight
		} else {
			c.coalesced++
		}
		c.mu.Unlock()
		if leader {
			return c.buildFlight(ctx, key, flight, build)
		}
		select {
		case <-ctx.Done():
			return stateTileCacheValue{}, ctx.Err()
		case <-flight.done:
		}
		if err := ctx.Err(); err != nil {
			return stateTileCacheValue{}, err
		}
		if errors.Is(flight.err, context.Canceled) || errors.Is(flight.err, context.DeadlineExceeded) {
			// The owner stopped. A remaining request may retry under its own
			// context, but must acquire the same bounded encoder admission.
			continue
		}
		return flight.value, flight.err
	}
}

func (c *stateTileCache) buildFlight(ctx context.Context, key string, flight *stateTileFlight, build func() (stateTileCacheValue, error)) (value stateTileCacheValue, err error) {
	// Even a panic must release waiters. Do not recover or publish a partial
	// response; the HTTP server retains its normal panic handling.
	finished := false
	defer func() {
		c.mu.Lock()
		if finished {
			flight.value, flight.err = value, err
		} else {
			flight.err = errors.New("tile encoding interrupted")
		}
		delete(c.flights, key)
		close(flight.done)
		c.mu.Unlock()
	}()
	// Another completed flight may have populated the cache after our initial
	// miss and before we acquired ownership. Recheck without counting a hit.
	if cached, ok := c.peek(key); ok {
		value = cached
	} else {
		value, err = build()
	}
	if cancelled := ctx.Err(); cancelled != nil {
		value, err = stateTileCacheValue{}, cancelled
	}
	if err == nil {
		c.put(key, value)
	} else {
		value = stateTileCacheValue{}
	}
	finished = true
	return value, err
}
