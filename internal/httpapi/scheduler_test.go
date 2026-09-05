package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func awaitScheduler(t *testing.T, s *requestScheduler, predicate func(map[string]uint64) bool) {
	t.Helper()
	deadline := time.After(3 * time.Second)
	tick := time.NewTicker(time.Millisecond)
	defer tick.Stop()
	for !predicate(s.stats()) {
		select {
		case <-deadline:
			t.Fatalf("scheduler did not reach expected state: %v", s.stats())
		case <-tick.C:
		}
	}
}

func holdScheduler(t *testing.T, s *requestScheduler) func() {
	t.Helper()
	release, err := s.acquire(context.Background(), interactiveRequest)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(release)
	return release
}

func TestRequestSchedulerWeightedFIFO(t *testing.T) {
	s := newRequestScheduler(1, 32, requestQueueTimeout)
	release := holdScheduler(t, s)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type granted struct {
		class   requestClass
		index   int
		release func()
	}
	grants := make(chan granted, 14)
	count := uint64(0)
	// Low priority arrives first. Every class has a backlog for two rounds.
	for _, group := range []struct {
		class requestClass
		count int
	}{{bulkRequest, 2}, {trajectoryWork, 4}, {interactiveRequest, 8}} {
		for index := 0; index < group.count; index++ {
			go func(class requestClass, index int) {
				r, err := s.acquire(ctx, class)
				if err == nil {
					grants <- granted{class, index, r}
				}
			}(group.class, index)
			count++
			awaitScheduler(t, s, func(v map[string]uint64) bool { return v["queued"] == count })
		}
	}
	release()
	var indexes [requestClassCount]int
	for n := 0; n < 14; n++ {
		select {
		case g := <-grants:
			if g.class != requestSchedule[n%7] || g.index != indexes[g.class] {
				g.release()
				t.Fatalf("grant %d: class=%d index=%d expected class=%d indexes=%v", n, g.class, g.index, requestSchedule[n%7], indexes)
			}
			indexes[g.class]++
			g.release()
			g.release() // the lease cannot be returned twice
		case <-time.After(3 * time.Second):
			t.Fatal("queued request starved")
		}
	}
	if v := s.stats(); v["active"] != 0 || v["queued"] != 0 || v["peakQueued"] != 14 {
		t.Fatal(v)
	}
}

func TestRequestSchedulerClassCapacityAndCancellation(t *testing.T) {
	s := newRequestScheduler(1, 1, requestQueueTimeout)
	release := holdScheduler(t, s)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		r, err := s.acquire(ctx, bulkRequest)
		if r != nil {
			r()
		}
		result <- err
	}()
	awaitScheduler(t, s, func(v map[string]uint64) bool { return v["bulkQueued"] == 1 })
	if r, err := s.acquire(context.Background(), bulkRequest); !errors.Is(err, errRequestQueueFull) || r != nil {
		t.Fatalf("full class admitted: release=%v err=%v", r != nil, err)
	}
	// A full scan queue does not prevent an interactive request from queueing.
	healthy := make(chan error, 1)
	go func() {
		r, err := s.acquire(ctx, interactiveRequest)
		if r != nil {
			r()
		}
		healthy <- err
	}()
	awaitScheduler(t, s, func(v map[string]uint64) bool { return v["queued"] == 2 })
	cancel()
	for _, ch := range []chan error{result, healthy} {
		select {
		case err := <-ch:
			if !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("cancellation did not leave queue")
		}
	}
	if v := s.stats(); v["queued"] != 0 || v["bulkRejected"] != 1 || v["interactiveCancelled"] != 1 || v["bulkCancelled"] != 1 {
		t.Fatal(v)
	}
	release()
	holdScheduler(t, s)() // cancellation did not leak capacity
}

func TestRequestSchedulerWaitExpiry(t *testing.T) {
	s := newRequestScheduler(1, 1, 5*time.Millisecond)
	holdScheduler(t, s)
	if r, err := s.acquire(context.Background(), trajectoryWork); !errors.Is(err, errRequestQueueTimeout) || r != nil {
		t.Fatalf("queue timeout: release=%v err=%v", r != nil, err)
	}
	if v := s.stats(); v["trajectoryExpired"] != 1 || v["queued"] != 0 || v["active"] != 1 || v["trajectoryWaitNs"] == 0 {
		t.Fatal(v)
	}
}

func TestRequestSchedulerCancelGrantRace(t *testing.T) {
	for n := 0; n < 100; n++ {
		s := newRequestScheduler(1, 1, requestQueueTimeout)
		release := holdScheduler(t, s)
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() {
			r, err := s.acquire(ctx, bulkRequest)
			if r != nil {
				r()
			}
			done <- err
		}()
		awaitScheduler(t, s, func(v map[string]uint64) bool { return v["queued"] == 1 })
		go cancel()
		release()
		select {
		case err := <-done:
			if err != nil && !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("grant/cancel race deadlocked")
		}
		cancel()
		if v := s.stats(); v["active"] != 0 || v["queued"] != 0 {
			t.Fatal(v)
		}
	}
}

func TestRequestSchedulerConcurrencyBound(t *testing.T) {
	s := newRequestScheduler(3, 32, requestQueueTimeout)
	var running, peak atomic.Int64
	var wg sync.WaitGroup
	errorsCh := make(chan error, 60)
	for n := 0; n < 60; n++ {
		wg.Add(1)
		go func(class requestClass) {
			defer wg.Done()
			release, err := s.acquire(context.Background(), class)
			if err != nil {
				errorsCh <- err
				return
			}
			active := running.Add(1)
			for old := peak.Load(); active > old; old = peak.Load() {
				if peak.CompareAndSwap(old, active) {
					break
				}
			}
			time.Sleep(time.Millisecond)
			running.Add(-1)
			release()
		}(requestClass(n % 3))
	}
	wg.Wait()
	close(errorsCh)
	for err := range errorsCh {
		t.Error(err)
	}
	if v := s.stats(); peak.Load() > 3 || v["active"] != 0 || v["queued"] != 0 {
		t.Fatalf("peak=%d stats=%v", peak.Load(), v)
	}
}

type admissionReadProbe struct{ reads int }

func (p *admissionReadProbe) Read([]byte) (int, error) { p.reads++; return 0, io.EOF }
func (p *admissionReadProbe) Close() error             { return nil }

func TestHTTPSchedulerTimeoutBeforeBodyDecode(t *testing.T) {
	s := testServer(t)
	s.scheduler = newRequestScheduler(1, 1, 5*time.Millisecond)
	holdScheduler(t, s.scheduler)
	body := &admissionReadProbe{}
	r := httptest.NewRequest(http.MethodPost, "/v1/state/plan", nil)
	r.Body = body
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, r)
	if rr.Code != http.StatusTooManyRequests || rr.Header().Get("Retry-After") != "1" || body.reads != 0 {
		t.Fatalf("status=%d reads=%d body=%s", rr.Code, body.reads, rr.Body.String())
	}
	if v := s.SchedulerStats(); v["interactiveExpired"] != 1 || v["queued"] != 0 {
		t.Fatal(v)
	}
}

func TestHTTPSchedulerQueuedCancellationAndRecovery(t *testing.T) {
	s := testServer(t)
	s.scheduler = newRequestScheduler(1, 1, requestQueueTimeout)
	release := holdScheduler(t, s.scheduler)
	server := httptest.NewServer(s)
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// With no unread body, net/http observes the peer close while admission is
	// waiting. HTTP/1 POST bodies can delay that notification until read; the
	// scheduler's independent wait expiry bounds that case instead.
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/v1/catalog/manifest", nil)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		response, err := server.Client().Do(r)
		if response != nil {
			response.Body.Close()
		}
		done <- err
	}()
	awaitScheduler(t, s.scheduler, func(v map[string]uint64) bool { return v["interactiveQueued"] == 1 })
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("HTTP cancellation blocked")
	}
	awaitScheduler(t, s.scheduler, func(v map[string]uint64) bool { return v["queued"] == 0 && v["interactiveCancelled"] == 1 })
	release()
	response, err := server.Client().Get(server.URL + "/v1/catalog/manifest")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatal(response.StatusCode)
	}
}

func TestRequestSchedulerRouteClasses(t *testing.T) {
	for _, row := range []struct {
		method, path string
		class        requestClass
	}{
		{"POST", "/v1/state/plan", interactiveRequest},
		{"POST", "/v1/state/tiles", interactiveRequest},
		{"GET", "/v1/catalog/manifest", interactiveRequest},
		{"GET", "/v1/coverage/targets", interactiveRequest},
		{"GET", "/v1/identities/sb:1", interactiveRequest},
		{"POST", "/v1/trajectory", trajectoryWork},
		{"GET", "/v1/catalog?limit=500", bulkRequest},
		{"GET", "/v1/inventory?q=Ceres", bulkRequest},
		{"GET", "/v1/identities", bulkRequest},
	} {
		if got := classifyRequest(httptest.NewRequest(row.method, row.path, nil)); got != row.class {
			t.Errorf("%s %s = %d, want %d", row.method, row.path, got, row.class)
		}
	}
}

func TestHTTPSchedulerFullClassDoesNotFillOtherQueues(t *testing.T) {
	s := testServer(t)
	s.scheduler = newRequestScheduler(1, requestQueueCapacity, requestQueueTimeout)
	release := holdScheduler(t, s.scheduler)
	ctx, cancel := context.WithCancel(context.Background())
	server := httptest.NewServer(s)
	defer func() { cancel(); release(); server.Close() }()
	client := server.Client()
	client.Timeout = 4 * time.Second
	done := make(chan error, requestQueueCapacity+1)
	start := func(path string) {
		t.Helper()
		r, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		go func() {
			res, err := client.Do(r)
			if res != nil {
				res.Body.Close()
			}
			done <- err
		}()
	}
	for n := 0; n < requestQueueCapacity; n++ {
		start("/v1/catalog?limit=1")
	}
	awaitScheduler(t, s.scheduler, func(v map[string]uint64) bool { return v["bulkQueued"] == requestQueueCapacity })
	response, err := client.Get(server.URL + "/v1/catalog?limit=1")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusTooManyRequests || response.Header.Get("Retry-After") != "1" {
		t.Fatalf("33rd bulk status=%d retry=%q", response.StatusCode, response.Header.Get("Retry-After"))
	}
	start("/v1/catalog/manifest")
	awaitScheduler(t, s.scheduler, func(v map[string]uint64) bool {
		return v["interactiveQueued"] == 1 && v["bulkQueued"] == requestQueueCapacity
	})
	cancel()
	for n := 0; n < requestQueueCapacity+1; n++ {
		select {
		case err := <-done:
			if !errors.Is(err, context.Canceled) {
				t.Errorf("queued client: %v", err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("queued client did not terminate")
		}
	}
	awaitScheduler(t, s.scheduler, func(v map[string]uint64) bool { return v["queued"] == 0 })
}
