package httpapi

import (
	"container/list"
	"context"
	"errors"
	"net/http"
	"sync"
	"time"
)

type requestClass int

const (
	interactiveRequest requestClass = iota
	trajectoryWork
	bulkRequest
	requestClassCount
	requestQueueCapacity = 32 // per class, independent of the worker limit
	requestQueueTimeout  = 5 * time.Second
)

var (
	errRequestQueueFull    = errors.New("request queue is full")
	errRequestQueueTimeout = errors.New("request queue wait expired")
	requestSchedule        = [...]requestClass{interactiveRequest, interactiveRequest, interactiveRequest, interactiveRequest, trajectoryWork, trajectoryWork, bulkRequest}
)

// Routes select the admission class. State-tile clients may explicitly lower
// historical samples to the trajectory queue, but cannot raise bulk priority.
// Bulk here means directory scans; no background precomputation is implied.
func classifyRequest(r *http.Request) requestClass {
	if r.Method == http.MethodPost && (r.URL.Path == "/v1/state/plan" || r.URL.Path == "/v1/state/tiles") && r.URL.Query().Get("workload") == "trajectory" {
		return trajectoryWork
	}
	if r.Method == http.MethodPost && r.URL.Path == "/v1/trajectory" {
		return trajectoryWork
	}
	if r.Method == http.MethodGet && (r.URL.Path == "/v1/catalog" || r.URL.Path == "/v1/inventory" || r.URL.Path == "/v1/identities") {
		return bulkRequest
	}
	return interactiveRequest
}

type requestWaiter struct {
	ready   chan struct{}
	element *list.Element
	granted bool
}

// requestScheduler is non-preemptive weighted round robin with FIFO within
// each class. At saturation every nonempty class is visited within seven
// grants, not seven milliseconds. Running handlers retain their own deadlines.
// No worker goroutines or decoded request bodies are created while waiting.
type requestScheduler struct {
	mu          sync.Mutex
	limit       int
	capacity    int
	waitTimeout time.Duration
	active      int
	cursor      int
	queues      [requestClassCount]list.List
	grants      [requestClassCount]uint64
	rejected    [requestClassCount]uint64
	cancelled   [requestClassCount]uint64
	expired     [requestClassCount]uint64
	waitNs      [requestClassCount]uint64
	peakQueued  int
}

func newRequestScheduler(limit, capacity int, timeout time.Duration) *requestScheduler {
	if limit < 1 {
		limit = 1
	}
	if capacity < 0 {
		capacity = 0
	}
	return &requestScheduler{limit: limit, capacity: capacity, waitTimeout: timeout}
}

func (s *requestScheduler) acquire(ctx context.Context, class requestClass) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	if s.active < s.limit && s.queuedLocked() == 0 {
		s.active++
		s.grants[class]++
		s.mu.Unlock()
		return s.releaseFunc(), nil
	}
	if s.queues[class].Len() >= s.capacity {
		s.rejected[class]++
		s.mu.Unlock()
		return nil, errRequestQueueFull
	}
	start := time.Now()
	waitCtx, cancel := context.WithTimeout(ctx, s.waitTimeout)
	waiter := &requestWaiter{ready: make(chan struct{})}
	waiter.element = s.queues[class].PushBack(waiter)
	if count := s.queuedLocked(); count > s.peakQueued {
		s.peakQueued = count
	}
	s.mu.Unlock()

	defer cancel()
	select {
	case <-waitCtx.Done():
	case <-waiter.ready:
	}
	s.mu.Lock()
	s.waitNs[class] += uint64(time.Since(start).Nanoseconds())
	if err := waitCtx.Err(); err != nil {
		if waiter.granted {
			// Cancellation can race a grant. Return that reserved slot before
			// reporting cancellation; never leak admission to a dead request.
			s.active--
		} else {
			s.queues[class].Remove(waiter.element)
		}
		if ctx.Err() != nil {
			err = ctx.Err()
			s.cancelled[class]++
		} else {
			err = errRequestQueueTimeout
			s.expired[class]++
		}
		s.dispatchLocked()
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()
	return s.releaseFunc(), nil
}

func (s *requestScheduler) releaseFunc() func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			s.mu.Lock()
			s.active--
			s.dispatchLocked()
			s.mu.Unlock()
		})
	}
}

func (s *requestScheduler) queuedLocked() int {
	count := 0
	for n := range s.queues {
		count += s.queues[n].Len()
	}
	return count
}

func (s *requestScheduler) dispatchLocked() {
	for s.active < s.limit {
		found := false
		for checked := 0; checked < len(requestSchedule); checked++ {
			class := requestSchedule[s.cursor]
			s.cursor = (s.cursor + 1) % len(requestSchedule)
			front := s.queues[class].Front()
			if front == nil {
				continue
			}
			waiter := s.queues[class].Remove(front).(*requestWaiter)
			waiter.granted = true
			s.active++
			s.grants[class]++
			close(waiter.ready)
			found = true
			break
		}
		if !found {
			return
		}
	}
}

func (s *requestScheduler) stats() map[string]uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := map[string]uint64{"active": uint64(s.active), "maxActive": uint64(s.limit), "queued": uint64(s.queuedLocked()), "peakQueued": uint64(s.peakQueued), "maxQueuedPerClass": uint64(s.capacity), "queueWaitTimeoutNs": uint64(s.waitTimeout)}
	for n, name := range []string{"interactive", "trajectory", "bulk"} {
		result[name+"Queued"] = uint64(s.queues[n].Len())
		result[name+"Grants"] = s.grants[n]
		result[name+"Rejected"] = s.rejected[n]
		result[name+"Cancelled"] = s.cancelled[n]
		result[name+"Expired"] = s.expired[n]
		result[name+"WaitNs"] = s.waitNs[n]
	}
	return result
}
