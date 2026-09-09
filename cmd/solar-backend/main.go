package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/coverage"
	"github.com/dajiaohuang/solar/backend/internal/httpapi"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
)

func main() {
	dataDir := flag.String("data-dir", "src/data", "directory containing ephemeris-manifest.json and ephemerisBodies.json")
	listen := flag.String("listen", ":8787", "HTTP listen address")
	maxConcurrent := flag.Int("max-concurrent", 8, "maximum concurrent scientific requests")
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
		runServer(server, *listen, cat)
		return
	}
	ledger, coverageErr := coverage.Load(*coverageReport, cat, inv)
	if coverageErr != nil {
		log.Fatalf("coverage report validation failed: %v", coverageErr)
	}
	server := httpapi.NewWithCoverage(cat, *maxConcurrent, inv, ledger)
	runServer(server, *listen, cat)
}

func runServer(server http.Handler, listen string, cat *catalog.Catalog) {
	s := &http.Server{Addr: listen, Handler: server, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("solar backend listening on %s (catalog=%d, pid=%d)", listen, cat.Len(), os.Getpid())
	if err := s.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
