package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/bodyshape"
	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/coverage"
	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
	"github.com/dajiaohuang/solar/backend/internal/httpapi"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
	"github.com/dajiaohuang/solar/backend/internal/orbituncertainty"
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
	maxConcurrent := flag.Int("max-concurrent", 8, "maximum concurrent requests in the general lane")
	computeWorkers := flag.Int("compute-workers", 0, "maximum concurrent evaluation blocks; 0 follows GOMAXPROCS")
	inventoryDir := flag.String("inventory-dir", "", "optional audited source-inventory directory containing manifest.json and JSONL shards")
	coverageReport := flag.String("coverage-report", "", "optional pinned coverage audit report; requires matching full catalog and inventory")
	eopManifest := flag.String("earth-orientation", "", "optional SHA-256-pinned IERS manifest for ground observations")
	pckPath := flag.String("body-radii", "", "optional original pck00011.tpc for ground sphere contact searches")
	orbitSPK := flag.String("orbit-spk", "", "optional pinned DE440 subset for covariance propagation; requires orbit-gm")
	orbitGM := flag.String("orbit-gm", "", "optional pinned gm_de440.tpc for covariance propagation; requires orbit-spk")
	flag.Parse()

	cat, inv, err := loadData(*dataDir, *inventoryDir)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := cat.Close(); closeErr != nil {
			log.Printf("catalog close warning: %v", closeErr)
		}
	}()
	var eop *earthorientation.Table
	if *eopManifest != "" {
		eop, err = earthorientation.Load(*eopManifest)
		if err != nil {
			return fmt.Errorf("Earth orientation configuration failed: %w", err)
		}
	}
	var ledger *coverage.Ledger
	var radii *bodyshape.Table
	if *pckPath != "" {
		radii, err = bodyshape.Load(*pckPath)
		if err != nil {
			return fmt.Errorf("body radii configuration failed: %w", err)
		}
	}
	if *coverageReport != "" {
		ledger, err = coverage.Load(*coverageReport, cat, inv)
		if err != nil {
			return fmt.Errorf("coverage report validation failed: %w", err)
		}
	}
	server := httpapi.NewWithCoverage(cat, *maxConcurrent, inv, ledger)
	server.ConfigureComputeWorkers(*computeWorkers)
	server.ConfigureEarthOrientation(eop)
	server.ConfigureBodyRadii(radii)
	if (*orbitSPK == "") != (*orbitGM == "") {
		return fmt.Errorf("orbit-spk and orbit-gm must be supplied together")
	}
	if *orbitSPK != "" {
		spkBytes, err := readOrbitSource(*orbitSPK, 5558272)
		if err != nil {
			return fmt.Errorf("orbit SPK configuration failed: %w", err)
		}
		gmBytes, err := readOrbitSource(*orbitGM, 1<<20)
		if err != nil {
			return fmt.Errorf("orbit GM configuration failed: %w", err)
		}
		source, err := orbituncertainty.NewDE440Source(context.Background(), spkBytes, gmBytes)
		if err != nil {
			return fmt.Errorf("orbit source configuration failed: %w", err)
		}
		server.ConfigureOrbitSource(source)
	}
	return runServer(server, *listen, cat)
}

func readOrbitSource(path string, limit int) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > int64(limit) {
		return nil, fmt.Errorf("expected regular nonempty source file of at most %d bytes", limit)
	}
	data, err := io.ReadAll(io.LimitReader(file, int64(limit)+1))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > limit {
		return nil, fmt.Errorf("source file exceeds byte budget")
	}
	return data, nil
}

// Configured data failures must stop startup before a healthy HTTP endpoint
// exists. A valid manifest can still describe explicitly missing SPK files.
func loadData(dataDir, inventoryDir string) (*catalog.Catalog, *inventory.Inventory, error) {
	cat, err := catalog.Load(dataDir)
	if err != nil {
		if cat != nil {
			_ = cat.Close()
		}
		return nil, nil, fmt.Errorf("catalog configuration failed: %w", err)
	}
	var inv *inventory.Inventory
	if inventoryDir != "" {
		inv, err = inventory.Load(inventoryDir)
		if err != nil {
			_ = cat.Close()
			return nil, nil, fmt.Errorf("inventory configuration failed: %w", err)
		}
	}
	return cat, inv, nil
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
