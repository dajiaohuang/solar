package stellarmotion

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
)

func TestCSVExperimentCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := FromCSVContext(ctx, nil, nil, "", 2026, ""); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation before parsing, got %v", err)
	}
}

func TestOriginalCSVExperiment(t *testing.T) {
	for _, directory := range []string{"gaia-pleiades-20260923", "gaia-six-20260923"} {
		root := "../../tests/fixtures/" + directory + "/"
		manifest, err := os.ReadFile(root + "manifest.json")
		if err != nil {
			t.Fatal(err)
		}
		rows, err := os.ReadFile(root + "rows.csv")
		if err != nil {
			t.Fatal(err)
		}
		result, err := FromCSV(manifest, rows, "65212004581252736", 2026, "spectroscopic-as-astrometric")
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(result.OriginalRows, rows) || !bytes.Equal(result.OriginalManifest, manifest) || result.RowsSHA256 != digest(rows) {
			t.Fatal("Original evidence changed")
		}
		if result.Result.SourceID != "65212004581252736" || result.Result.TargetEpochTCB != 2026 {
			t.Fatal("Source or epoch mismatch")
		}
		var selected Source
		if err = json.Unmarshal(result.SelectedSource, &selected); err != nil {
			t.Fatal(err)
		}
		if selected.RadialVelocity == nil || *selected.RadialVelocity != 10.600615 {
			t.Fatal("Lost original radial velocity")
		}
		manifest[0] = '!'
		rows[0] = '!'
		if result.OriginalManifest[0] == '!' || result.OriginalRows[0] == '!' {
			t.Fatal("Evidence aliases caller bytes")
		}
	}
}
func TestCSVExperimentRefusesBadEvidence(t *testing.T) {
	root := "../../tests/fixtures/gaia-six-20260923/"
	manifest, err := os.ReadFile(root + "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	rows, err := os.ReadFile(root + "rows.csv")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"1", "65212966653827840"} {
		if _, err = FromCSV(manifest, rows, id, 2026, "spectroscopic-as-astrometric"); err == nil {
			t.Fatal("Absent source or missing RV accepted")
		}
	}
	if _, err = FromCSV(manifest, append(append([]byte(nil), rows...), '\n'), "65212004581252736", 2026, "spectroscopic-as-astrometric"); err == nil {
		t.Fatal("Changed raw bytes accepted")
	}
	for _, key := range []string{"frame", "rows", "columns"} {
		var m map[string]any
		if err = json.Unmarshal(manifest, &m); err != nil {
			t.Fatal(err)
		}
		switch key {
		case "frame":
			m[key] = "FK5"
		case "rows":
			m[key] = 93
		case "columns":
			m[key].([]any)[1] = "wrong_epoch"
		}
		altered, _ := json.Marshal(m)
		if _, err = FromCSV(altered, rows, "65212004581252736", 2026, "spectroscopic-as-astrometric"); err == nil {
			t.Fatalf("Bad %s accepted", key)
		}
	}
}
