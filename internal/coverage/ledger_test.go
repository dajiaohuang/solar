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

func realCoverageInputs(t *testing.T) (string, string, string) {
	t.Helper()
	report := filepath.Join("..", "..", ".repostew", "cache", "solar-109-coverage-ledger-full-20260905-g", "report.json")
	inventoryDir := filepath.Join("..", "..", ".repostew", "cache", "solar-issue109-addressable-inventory-20260905-moon-mapping")
	dataDir := filepath.Join("..", "..", ".repostew", "cache", "solar-issue109-backend-full-20260905")
	if _, err := os.Stat(report); os.IsNotExist(err) {
		t.Skip("real coverage evidence is not available in this checkout")
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
