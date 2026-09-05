package coverage

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
)

func TestLookupReturnsDeepCopies(t *testing.T) {
	target := 42
	center := 399
	frame := 1
	typeID := 2
	start := 1.5
	end := 2.5
	gapET := 2.0
	ledger := &Ledger{targets: map[int]TargetCoverage{42: {
		Target:        42,
		Key:           "naif:42",
		SourceRecords: []SourceRecord{{ID: "source:42", Ordinal: 7, Source: "fixture", SourceRow: 8}},
		DependencyCoverage: WindowCoverage{
			Points: []WindowPoint{{ET: 1.5, Chain: []ChainStep{{Target: &target, Center: &center, Frame: &frame, Type: &typeID, StartET: &start, EndET: &end}}}},
			Gaps:   []WindowGap{{Kind: "interval", ET: &gapET, StartET: &start, EndET: &end, Chain: []ChainStep{{Target: &target}}}},
		},
	}}}
	first, ok := ledger.Lookup(42)
	if !ok {
		t.Fatal("expected fixture target")
	}
	*first.DependencyCoverage.Points[0].Chain[0].Target = 99
	*first.DependencyCoverage.Points[0].Chain[0].Center = 99
	*first.DependencyCoverage.Points[0].Chain[0].StartET = 99
	*first.DependencyCoverage.Gaps[0].ET = 99
	*first.DependencyCoverage.Gaps[0].StartET = 99
	*first.DependencyCoverage.Gaps[0].EndET = 99
	first.SourceRecords[0].ID = "changed"
	second, ok := ledger.Lookup(42)
	if !ok || second.SourceRecords[0].ID != "source:42" || second.DependencyCoverage.Points[0].ET != 1.5 || *second.DependencyCoverage.Points[0].Chain[0].Target != 42 || *second.DependencyCoverage.Points[0].Chain[0].Center != 399 || *second.DependencyCoverage.Points[0].Chain[0].StartET != 1.5 || *second.DependencyCoverage.Gaps[0].ET != 2 || *second.DependencyCoverage.Gaps[0].StartET != 1.5 || *second.DependencyCoverage.Gaps[0].EndET != 2.5 {
		t.Fatalf("lookup result was not isolated: %+v", second)
	}
}

func realCoverageInputs(t *testing.T) (string, string, string) {
	t.Helper()
	report := os.Getenv("SOLAR_COVERAGE_REPORT")
	inventoryDir := os.Getenv("SOLAR_COVERAGE_INVENTORY_DIR")
	dataDir := os.Getenv("SOLAR_COVERAGE_DATA_DIR")
	if report == "" || inventoryDir == "" || dataDir == "" {
		t.Skip("set SOLAR_COVERAGE_REPORT, SOLAR_COVERAGE_INVENTORY_DIR and SOLAR_COVERAGE_DATA_DIR for external coverage evidence")
	}
	return report, inventoryDir, dataDir
}

func loadRealCoverage(t *testing.T) (*Ledger, string, string, string) {
	t.Helper()
	report, inventoryDir, dataDir := realCoverageInputs(t)
	cat, err := catalog.Load(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cat.Close() })
	inv, err := inventory.Load(inventoryDir)
	if err != nil {
		t.Fatal(err)
	}
	ledger, err := Load(report, cat, inv)
	if err != nil {
		t.Fatal(err)
	}
	return ledger, report, inventoryDir, dataDir
}

func TestLoadRealCoverageReportAndTarget(t *testing.T) {
	ledger, _, _, _ := loadRealCoverage(t)
	summary := ledger.Summary()
	if summary.Purpose != "source-identity-and-dependency-window-audit" || summary.Profile != "full" || !summary.SourceBytesVerified || summary.Counts.SourceRecords != 1567193 || summary.Counts.MappedSourceRecords != 507 || summary.Counts.ExplicitNAIFTargets != 502 || summary.WindowCounts.DependencyCoveredTargets != 486 || summary.WindowCounts.TargetsWithDependencyGaps != 16 || summary.WindowCounts.NumericallyCertifiedWholeWindowTargets != nil {
		t.Fatalf("unexpected coverage summary: %+v", summary)
	}
	target, ok := ledger.Lookup(10)
	if !ok || target.Key != "naif:10" || target.StateAtAuditEpoch != "state-available-at-audit-epoch" || len(target.SourceRecords) != 1 || len(target.DependencyCoverage.Points) < 2 {
		t.Fatalf("unexpected target coverage: %+v", target)
	}
}

func TestLoadRejectsInventoryAndSPKHashMismatch(t *testing.T) {
	_, reportPath, inventoryDir, dataDir := loadRealCoverage(t)
	cat, err := catalog.Load(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer cat.Close()
	inv, err := inventory.Load(inventoryDir)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatal(err)
	}
	for name, replacement := range map[string]string{
		"inventory": strings.Repeat("0", 64),
		"spk":       strings.Repeat("1", 64),
	} {
		mutated := bytes.Replace(raw, []byte(map[string]string{
			"inventory": inv.ManifestHash(),
			"spk":       cat.ManifestHash(),
		}[name]), []byte(replacement), 1)
		path := filepath.Join(t.TempDir(), name+"-report.json")
		if err := os.WriteFile(path, mutated, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(path, cat, inv); err == nil {
			t.Fatalf("expected %s hash mismatch rejection", name)
		}
	}
}
