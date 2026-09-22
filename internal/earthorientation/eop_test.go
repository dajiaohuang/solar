package earthorientation

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) ([]byte, []Entry) {
	t.Helper()
	raw, err := os.ReadFile("../../tests/fixtures/iers-finals2000a-sample.txt")
	if err != nil {
		t.Fatal(err)
	}
	provenance, err := os.ReadFile("../../tests/fixtures/iers-finals2000a-provenance.json")
	if err != nil {
		t.Fatal(err)
	}
	var meta struct {
		FixtureSHA256 string `json:"fixtureSha256"`
	}
	if err := json.Unmarshal(provenance, &meta); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	if hex.EncodeToString(hash[:]) != meta.FixtureSHA256 {
		t.Fatal("original IERS fixture digest mismatch")
	}
	entries, err := ParseFinals2000A(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	return raw, entries
}

func TestOriginalIERSColumns(t *testing.T) {
	_, rows := fixture(t)
	if len(rows) != 6 {
		t.Fatal(len(rows))
	}
	first := rows[0]
	if first.MJD != 41684 || first.XP != .120733 || first.YP != .136966 || first.DUT1 != .8084178 || first.XPError != .009786 || first.DUT1Error != .000271 || first.DX == nil || *first.DX != -.766 || first.DY == nil || *first.DY != -.720 {
		t.Fatalf("incorrect fixed-width mapping: %+v", first)
	}
	if first.PoleFlag != "I" || first.UT1Flag != "I" || first.CPOFlag != "P" {
		t.Fatal("source quality flags lost")
	}
}

func TestInterpolationDoesNotSmearLeapSecond(t *testing.T) {
	_, rows := fixture(t)
	table := &Table{Manifest: Manifest{SHA256: "fixture"}, entries: rows}
	left, right := rows[3], rows[4]
	if math.Abs((right.DUT1-left.DUT1)-1) > .01 {
		t.Fatal("fixture must straddle the 2016 UTC leap second")
	}
	mid, err := table.AtUTC(2400000.5 + 57753.5)
	if err != nil {
		t.Fatal(err)
	}
	want := (left.DUT1 + right.DUT1 - 1) / 2
	if math.Abs(mid.DUT1-want) > 1e-12 {
		t.Fatalf("got %g, want %g (linear DUT1 would be wrong by 0.5 s)", mid.DUT1, want)
	}
	endpoint, err := table.AtUTC(2400000.5 + 57754)
	if err != nil || math.Abs(endpoint.DUT1-right.DUT1) > 1e-12 {
		t.Fatalf("leap boundary: %+v %v", endpoint, err)
	}
	if mid.SourceSHA256 != "fixture" || mid.BracketMJD != [2]float64{57753, 57754} {
		t.Fatal("missing interpolation provenance")
	}
}

func TestNoEOPExtrapolationOrGapFilling(t *testing.T) {
	_, rows := fixture(t)
	table := &Table{entries: rows}
	for _, mjd := range []float64{41683, 50000, 57756, math.NaN(), math.Inf(1)} {
		if _, err := table.AtUTC(2400000.5 + mjd); err == nil {
			t.Fatalf("accepted missing epoch %g", mjd)
		}
	}
	rows[1].DX, rows[1].DY, rows[1].CPOFlag = nil, nil, ""
	sample, err := table.AtUTC(2400000.5 + 41684.5)
	if err != nil {
		t.Fatal(err)
	}
	if sample.CPOAvailable || sample.DX != nil || sample.DY != nil {
		t.Fatal("invented missing celestial-pole corrections")
	}
}

func TestMalformedRecordsAndOrdering(t *testing.T) {
	raw, _ := fixture(t)
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	mutations := []string{
		"not a finals2000A record\n",
		lines[0] + "\n" + lines[0] + "\n",
		lines[1] + "\n" + lines[0] + "\n",
		lines[0][:18] + "      NaN" + lines[0][27:] + "\n" + lines[1] + "\n",
		lines[0][:16] + "X" + lines[0][17:] + "\n" + lines[1] + "\n",
	}
	for index, text := range mutations {
		if _, err := ParseFinals2000A(strings.NewReader(text)); err == nil {
			t.Fatalf("accepted malformed source %d", index)
		}
	}
}

func TestImmutableManifestAndChecksum(t *testing.T) {
	raw, _ := fixture(t)
	directory := t.TempDir()
	hash := sha256.Sum256(raw)
	digest := hex.EncodeToString(hash[:])
	manifest := Manifest{SchemaVersion: 1, SourceURL: SourceURL, RetrievedAt: "2026-09-22T16:38:44Z", SHA256: digest, Bytes: len(raw), Path: "finals2000A-" + digest + ".all"}
	path := filepath.Join(directory, "manifest.json")
	writeManifest := func() {
		data, _ := json.Marshal(manifest)
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, manifest.Path), raw, 0600); err != nil {
		t.Fatal(err)
	}
	writeManifest()
	table, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if table.Count() != 6 || table.CoverageMJD() != [2]float64{41684, 57755} {
		t.Fatal("coverage metadata mismatch")
	}
	manifest.Path = "../source.all"
	writeManifest()
	if _, err := Load(path); err == nil {
		t.Fatal("accepted a source path outside immutable identity")
	}
	manifest.Path = "finals2000A-" + digest + ".all"
	writeManifest()
	if err := os.WriteFile(filepath.Join(directory, manifest.Path), append(raw, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("accepted changed source bytes")
	}
}
