package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/httpapi"
)

func TestConfiguredDataFailureStopsStartup(t *testing.T) {
	for _, name := range []string{"empty-path", "missing-manifest", "malformed-manifest", "missing-inventory", "malformed-inventory"} {
		t.Run(name, func(t *testing.T) {
			dataDir := t.TempDir()
			manifest := `{"id":"startup-test","files":[]}`
			if name == "malformed-manifest" {
				manifest = `{`
			}
			if name != "missing-manifest" {
				if err := os.WriteFile(filepath.Join(dataDir, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if name == "empty-path" {
				dataDir = ""
			}
			inventoryDir, want := "", "catalog configuration failed"
			if strings.HasSuffix(name, "inventory") {
				inventoryDir, want = t.TempDir(), "inventory configuration failed"
				if name == "malformed-inventory" {
					if err := os.WriteFile(filepath.Join(inventoryDir, "manifest.json"), []byte(`{`), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			cat, inv, err := loadData(dataDir, inventoryDir)
			if err == nil || !strings.Contains(err.Error(), want) || cat != nil || inv != nil {
				t.Fatalf("loadData: catalog=%v inventory=%v error=%v; want %s", cat, inv, err, want)
			}
		})
	}
}

func TestValidManifestRetainsExplicitMissingStates(t *testing.T) {
	dataDir := t.TempDir()
	manifest := `{"id":"startup-test","files":[{"id":"missing-kernel","path":"not-packaged.bsp","targets":[12345]}]}`
	if err := os.WriteFile(filepath.Join(dataDir, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	cat, inv, err := loadData(dataDir, "")
	if err != nil {
		t.Fatal(err)
	}
	defer cat.Close()
	if inv != nil {
		t.Fatal("unconfigured inventory must remain absent")
	}
	server := httpapi.New(cat, 1)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest("GET", "/v1/bodies/naif:12345", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"missingReason":"kernel-not-packaged"`) {
		t.Fatalf("missing state was not retained: %d %s", response.Code, response.Body.String())
	}
}

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
