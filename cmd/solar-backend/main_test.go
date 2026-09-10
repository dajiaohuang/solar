package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDrainWaitsForActiveWorkAndRejectsNewWork(t *testing.T) {
	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	h := &drainingHandler{done: make(chan struct{}), handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); <-release; w.WriteHeader(200) })}
	go func() {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/v1/catalog", nil))
		close(finished)
	}()
	<-entered
	h.drain()
	select {
	case <-h.done:
		t.Fatal("released files while active work remained")
	default:
	}
	for path, status := range map[string]int{"/v1/health/ready": 503, "/v1/health/live": 200, "/v1/state/window": 503} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != status {
			t.Fatalf("%s: %d", path, r.Code)
		}
	}
	close(release)
	<-finished
	<-h.done
	h.drain() // idempotent signal handling
}
