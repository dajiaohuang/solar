package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestStartupEvidenceDoesNotConfuseCurrentMemoryWithOSPeak(t *testing.T) {
	start := time.Now()
	got := captureStartup(start)
	if got.ElapsedMs < 0 || got.HeapBytes == 0 {
		t.Fatalf("invalid startup sample: %+v", got)
	}
	if !got.ProcessPeakAvailable && got.ProcessPeakRSSBytes != 0 {
		t.Fatal("unavailable OS peak has a value")
	}
	if runtime.GOOS != "windows" && got.ProcessPeakAvailable {
		t.Fatal("unsupported OS peak was inferred from a sample")
	}
	if !strings.Contains(got.Scope, "filesystem cache uncontrolled") || !strings.Contains(got.Scope, "excludes request workloads") {
		t.Fatal("startup scope lost measurement limits")
	}
	raw, err := json.Marshal(report{Startup: got})
	if err != nil || !strings.Contains(string(raw), `"startup":`) || !strings.Contains(string(raw), `"processPeakAvailable":`) {
		t.Fatal("startup measurement availability omitted from report")
	}
}

func TestStartupOnlyDoesNotWarmOrEvaluateKernels(t *testing.T) {
	const fixtureEnv = "SOLAR_BENCH_STARTUP_TEST_DIR"
	if dir := os.Getenv(fixtureEnv); dir != "" {
		os.Args = []string{"bench", "-startup-only", "-data-dir", dir}
		flag.CommandLine = flag.NewFlagSet("startup-test", flag.ExitOnError)
		main()
		return
	}
	dir := t.TempDir()
	// The manifest declares a packaged candidate, but its bytes are deliberately
	// not a valid SPK. Startup must not warm/verify it or report exact states.
	if err := os.WriteFile(filepath.Join(dir, "unopened.bsp"), []byte("bad"), 0600); err != nil {
		t.Fatal(err)
	}
	manifest := `{"id":"startup-test","files":[{"id":"unopened","path":"unopened.bsp","targets":[12345],"bytes":3,"sha256":"` + strings.Repeat("0", 64) + `"}]}`
	if err := os.WriteFile(filepath.Join(dir, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStartupOnlyDoesNotWarmOrEvaluateKernels$")
	command.Env = append(os.Environ(), fixtureEnv+"="+dir)
	raw, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("startup process failed: %v %s", err, raw)
	}
	var got report
	if err := json.NewDecoder(bytes.NewReader(raw)).Decode(&got); err != nil {
		t.Fatalf("invalid startup report: %v %s", err, raw)
	}
	if got.Mode != "startup-only" || got.CatalogPackagedFiles != 1 || len(got.CatalogManifestSHA256) != 64 {
		t.Fatalf("startup identity/mode missing: %+v", got)
	}
	if got.Requests != 0 || len(got.StateTiles) != 0 || len(got.StateTilesSource) != 0 {
		t.Fatal("startup ran request workloads")
	}
	for key, value := range got.CatalogIntegrity {
		if key == "pending" {
			if value != 1 {
				t.Fatal("startup lost the unverified candidate")
			}
			continue
		}
		if value != 0 {
			t.Fatalf("startup performed integrity work: %s=%d", key, value)
		}
	}
}
