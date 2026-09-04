package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/httpapi"
)

func main() {
	dataDir := flag.String("data-dir", "src/data", "directory containing ephemeris-manifest.json and ephemerisBodies.json")
	listen := flag.String("listen", ":8787", "HTTP listen address")
	maxConcurrent := flag.Int("max-concurrent", 8, "maximum concurrent scientific requests")
	flag.Parse()

	cat, err := catalog.Load(*dataDir)
	if err != nil {
		log.Printf("catalog warning: %v", err)
	}
	server := httpapi.New(cat, *maxConcurrent)
	s := &http.Server{Addr: *listen, Handler: server, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("solar backend listening on %s (catalog=%d, pid=%d)", *listen, cat.Len(), os.Getpid())
	if err := s.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
