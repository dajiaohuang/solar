package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/coverage"
	"github.com/dajiaohuang/solar/backend/internal/httpapi"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	dataDir := flag.String("data-dir", "src/data", "directory containing ephemeris-manifest.json and ephemerisBodies.json")
	listen := flag.String("listen", ":8787", "HTTP listen address")
	maxConcurrent := flag.Int("max-concurrent", 8, "maximum concurrent scientific requests")
	computeWorkers := flag.Int("compute-workers", 0, "maximum concurrent evaluation blocks; 0 follows GOMAXPROCS")
	inventoryDir := flag.String("inventory-dir", "", "optional audited source-inventory directory containing manifest.json and JSONL shards")
	coverageReport := flag.String("coverage-report", "", "optional pinned coverage audit report; requires matching full catalog and inventory")
	flag.Parse()

	cat, err := catalog.Load(*dataDir)
	if err != nil {
		log.Printf("catalog warning: %v", err)
	}
	defer func() {
		if closeErr := cat.Close(); closeErr != nil {
			log.Printf("catalog close warning: %v", closeErr)
		}
	}()
	var inv *inventory.Inventory
	if *inventoryDir != "" {
		var inventoryErr error
		inv, inventoryErr = inventory.Load(*inventoryDir)
		if inventoryErr != nil {
			log.Printf("inventory warning: %v", inventoryErr)
		}
	}
	if *coverageReport == "" {
		server := httpapi.New(cat, *maxConcurrent, inv)
		server.ConfigureComputeWorkers(*computeWorkers)
		return runServer(server, *listen, cat)
	}
	ledger, coverageErr := coverage.Load(*coverageReport, cat, inv)
	if coverageErr != nil {
		return fmt.Errorf("coverage report validation failed: %w", coverageErr)
	}
	server := httpapi.NewWithCoverage(cat, *maxConcurrent, inv, ledger)
	server.ConfigureComputeWorkers(*computeWorkers)
	return runServer(server, *listen, cat)
}

func runServer(server http.Handler, listen string, cat *catalog.Catalog) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	s := &http.Server{Addr: listen, Handler: server, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("solar backend listening on %s (catalog=%d, pid=%d)", listen, cat.Len(), os.Getpid())
	return serveUntilCancelled(ctx, s, 30*time.Second)
}

// Wait for Shutdown itself, not just ListenAndServe, before closing shared
// kernel files. On grace expiry Close cancels active HTTP request contexts.
func serveUntilCancelled(ctx context.Context, server *http.Server, grace time.Duration) error {
	active := &drainingHandler{handler: server.Handler, done: make(chan struct{})}
	server.Handler = active
	stopped := make(chan error, 1)
	go func() { stopped <- server.ListenAndServe() }()
	select {
	case err := <-stopped:
		if err == http.ErrServerClosed {
			return nil
		}
		return err
	case <-ctx.Done():
		active.drain()
		deadline, cancel := context.WithTimeout(context.Background(), grace)
		defer cancel()
		err := server.Shutdown(deadline)
		if err != nil {
			_ = server.Close()
		}
		<-stopped
		// Close cancels connections but does not join handler goroutines.
		// Keep shared scientific files open until their owners actually return.
		<-active.done
		return err
	}
}

type drainingHandler struct {
	handler  http.Handler
	mu       sync.Mutex
	count    int
	stopping bool
	done     chan struct{}
}

func (h *drainingHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	if h.stopping {
		h.mu.Unlock()
		if r.URL.Path == "/v1/health/live" {
			w.WriteHeader(http.StatusOK)
		} else {
			http.Error(w, "server draining", http.StatusServiceUnavailable)
		}
		return
	}
	h.count++
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		h.count--
		if h.stopping && h.count == 0 {
			close(h.done)
		}
		h.mu.Unlock()
	}()
	h.handler.ServeHTTP(w, r)
}

func (h *drainingHandler) drain() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.stopping {
		return
	}
	h.stopping = true
	if h.count == 0 {
		close(h.done)
	}
}
