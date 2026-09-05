// Package coverage exposes a bounded, immutable view of a pinned coverage
// audit. The report is evidence for one audit epoch and dependency window; it
// is not a live state or numerical-accuracy oracle.
package coverage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
)

const (
	// MaxReportBytes bounds startup memory and prevents a client-facing service
	// from accidentally loading an unbounded audit artifact.
	MaxReportBytes     = 8 << 20
	MaxSummaryBytes    = 64 << 10
	maxTargetGroups    = 2048
	maxSourceRefs      = 4096
	maxSourceRefsTotal = 8192
	maxWindowAtoms     = 256
	maxChainSteps      = 64
	maxSummaryReasons  = 128
)

type Summary struct {
	Purpose                 string         `json:"purpose"`
	ReportSHA256            string         `json:"reportSha256"`
	CatalogVersion          string         `json:"catalogVersion"`
	CatalogManifestSHA256   string         `json:"catalogManifestSha256"`
	InventoryManifestSHA256 string         `json:"inventoryManifestSha256"`
	SourceSnapshotSHA256    string         `json:"sourceSnapshotSha256"`
	IdentityMappingSHA256   string         `json:"identityMappingSha256"`
	SatelliteCatalogSHA256  string         `json:"satelliteCatalogSha256"`
	SourceBytesVerified     bool           `json:"sourceBytesVerified"`
	Profile                 string         `json:"profile"`
	AuditET                 float64        `json:"auditEt"`
	TimeScale               string         `json:"timeScale"`
	Frame                   string         `json:"frame"`
	RequestedWindow         Window         `json:"requestedWindow"`
	Counts                  Counts         `json:"counts"`
	WindowCounts            WindowCounts   `json:"windowCounts"`
	UnresolvedReasons       map[string]int `json:"unresolvedReasons"`
}

type Counts struct {
	SourceRecords             int `json:"sourceRecords"`
	MappedSourceRecords       int `json:"mappedSourceRecords"`
	UnresolvedSourceRecords   int `json:"unresolvedSourceRecords"`
	ExplicitNAIFTargets       int `json:"explicitNaifTargets"`
	AvailableTargetsAtAuditET int `json:"availableTargetsAtAuditEpoch"`
}

type WindowCounts struct {
	DependencyCoveredTargets               int  `json:"dependencyCoveredTargets"`
	TargetsWithDependencyGaps              int  `json:"targetsWithDependencyGaps"`
	NumericallyCertifiedWholeWindowTargets *int `json:"numericallyCertifiedWholeWindowTargets"`
}

type Window struct {
	StartET   float64 `json:"startEt"`
	EndET     float64 `json:"endEt"`
	TimeScale string  `json:"timeScale,omitempty"`
}

type SourceRecord struct {
	ID        string `json:"id"`
	Ordinal   int    `json:"ordinal"`
	Source    string `json:"source"`
	SourceRow int    `json:"sourceRow"`
}

type ChainStep struct {
	Target   *int     `json:"target,omitempty"`
	KernelID string   `json:"kernelId,omitempty"`
	Origin   string   `json:"origin,omitempty"`
	Center   *int     `json:"center,omitempty"`
	Frame    *int     `json:"frame,omitempty"`
	Type     *int     `json:"type,omitempty"`
	StartET  *float64 `json:"startEt,omitempty"`
	EndET    *float64 `json:"endEt,omitempty"`
	Context  string   `json:"context,omitempty"`
}

type WindowPoint struct {
	ET     float64     `json:"et"`
	State  string      `json:"state"`
	Reason string      `json:"reason,omitempty"`
	Chain  []ChainStep `json:"chain"`
}

type WindowInterval struct {
	StartET  float64     `json:"startEt"`
	EndET    float64     `json:"endEt"`
	Openness string      `json:"openness"`
	State    string      `json:"state"`
	Reason   string      `json:"reason,omitempty"`
	Chain    []ChainStep `json:"chain"`
}

type WindowGap struct {
	Kind    string      `json:"kind"`
	ET      *float64    `json:"et,omitempty"`
	StartET *float64    `json:"startEt,omitempty"`
	EndET   *float64    `json:"endEt,omitempty"`
	Reason  string      `json:"reason"`
	Chain   []ChainStep `json:"chain"`
}

type WindowCoverage struct {
	Points    []WindowPoint    `json:"points"`
	Intervals []WindowInterval `json:"intervals"`
	Gaps      []WindowGap      `json:"gaps"`
}

type TargetCoverage struct {
	Target             int            `json:"target"`
	Key                string         `json:"key"`
	StateAtAuditEpoch  string         `json:"stateAtAuditEpoch"`
	SourceRecords      []SourceRecord `json:"sourceRecords"`
	DependencyCoverage WindowCoverage `json:"dependencyCoverage"`
	Meaning            string         `json:"meaning"`
}

type Ledger struct {
	summary Summary
	targets map[int]TargetCoverage
}

// Load reads and validates one report exactly once. It binds the report to the
// already-loaded inventory and catalog; callers should retain the returned
// immutable Ledger for all requests.
func Load(path string, cat *catalog.Catalog, inv *inventory.Inventory) (*Ledger, error) {
	if cat == nil || inv == nil {
		return nil, fmt.Errorf("coverage report requires catalog and inventory")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open coverage report: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("stat coverage report: %w", err)
	}
	if info.Size() < 1 || info.Size() > MaxReportBytes {
		return nil, fmt.Errorf("coverage report exceeds %d-byte limit", MaxReportBytes)
	}
	raw, err := io.ReadAll(io.LimitReader(file, MaxReportBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read coverage report: %w", err)
	}
	if len(raw) > MaxReportBytes {
		return nil, fmt.Errorf("coverage report exceeds %d-byte limit", MaxReportBytes)
	}
	var report reportFile
	if err := json.Unmarshal(raw, &report); err != nil {
		return nil, fmt.Errorf("parse coverage report: %w", err)
	}
	if err := validateExplicitFields(raw); err != nil {
		return nil, err
	}
	if err := validateReport(report, cat, inv); err != nil {
		return nil, err
	}
	reportSum := sha256.Sum256(raw)
	windows := make(map[int]reportWindow, len(report.Windows))
	for _, window := range report.Windows {
		windows[window.Target] = window
	}
	targets := make(map[int]TargetCoverage, len(report.Identity.ExplicitTargetGroups))
	for _, group := range report.Identity.ExplicitTargetGroups {
		window := windows[group.Target]
		coverage := window.DependencyCoverage
		coverage.Gaps = append([]WindowGap(nil), window.Gaps...)
		targets[group.Target] = TargetCoverage{
			Target:             group.Target,
			Key:                group.Key,
			StateAtAuditEpoch:  group.StateAtAuditEpoch,
			SourceRecords:      append([]SourceRecord(nil), group.SourceRecords...),
			DependencyCoverage: cloneWindowCoverage(coverage),
			Meaning:            window.Meaning,
		}
	}
	summary := Summary{
		Purpose:                 report.Purpose,
		ReportSHA256:            hex.EncodeToString(reportSum[:]),
		CatalogVersion:          cat.Version(),
		CatalogManifestSHA256:   cat.ManifestHash(),
		InventoryManifestSHA256: inv.ManifestHash(),
		SourceSnapshotSHA256:    report.SourceSnapshotSHA256,
		IdentityMappingSHA256:   report.Kernels.IdentityMappingSHA256,
		SatelliteCatalogSHA256:  report.Kernels.SatelliteCatalogSHA256,
		SourceBytesVerified:     report.SourceBytesVerified,
		Profile:                 report.Kernels.Profile,
		AuditET:                 report.Kernels.AuditET,
		TimeScale:               report.Kernels.TimeScale,
		Frame:                   report.Kernels.Frame,
		RequestedWindow:         Window{StartET: report.RequestedWindow.StartET, EndET: report.RequestedWindow.EndET, TimeScale: report.RequestedWindow.TimeScale},
		Counts:                  report.Identity.Counts,
		WindowCounts:            report.WindowCounts,
		UnresolvedReasons:       cloneCounts(report.Identity.UnresolvedReasons),
	}
	encodedSummary, err := json.Marshal(struct {
		APIVersion string `json:"apiVersion"`
		Summary
	}{catalog.APIVersion, summary})
	if err != nil || len(encodedSummary)+1 > MaxSummaryBytes {
		return nil, fmt.Errorf("coverage summary exceeds %d-byte limit", MaxSummaryBytes)
	}
	return &Ledger{summary: summary, targets: targets}, nil
}

func (l *Ledger) Summary() Summary {
	if l == nil {
		return Summary{}
	}
	out := l.summary
	out.UnresolvedReasons = cloneCounts(out.UnresolvedReasons)
	return out
}

func (l *Ledger) Lookup(target int) (TargetCoverage, bool) {
	if l == nil {
		return TargetCoverage{}, false
	}
	value, ok := l.targets[target]
	if !ok {
		return TargetCoverage{}, false
	}
	value.SourceRecords = append([]SourceRecord(nil), value.SourceRecords...)
	value.DependencyCoverage = cloneWindowCoverage(value.DependencyCoverage)
	return value, true
}

type reportFile struct {
	SchemaVersion        int            `json:"schemaVersion"`
	Purpose              string         `json:"purpose"`
	InputInventorySHA256 string         `json:"inputInventorySha256"`
	SourceSnapshotSHA256 string         `json:"sourceSnapshotSha256"`
	SourceBytesVerified  bool           `json:"sourceBytesVerified"`
	Kernels              reportKernels  `json:"kernels"`
	RequestedWindow      Window         `json:"requestedWindow"`
	Identity             reportIdentity `json:"identity"`
	WindowCounts         WindowCounts   `json:"windowCounts"`
	Windows              []reportWindow `json:"windows"`
	Limitations          []string       `json:"limitations"`
}

type reportKernels struct {
	ManifestID             string  `json:"manifestId"`
	Profile                string  `json:"profile"`
	ManifestSHA256         string  `json:"manifestSha256"`
	AuditET                float64 `json:"auditEt"`
	IdentityMappingSHA256  string  `json:"identityMappingSha256"`
	SatelliteCatalogSHA256 string  `json:"satelliteCatalogSha256"`
	TimeScale              string  `json:"timeScale"`
	Frame                  string  `json:"frame"`
	PositionUnit           string  `json:"positionUnit"`
	VelocityUnit           string  `json:"velocityUnit"`
	Meaning                string  `json:"meaning"`
}

type reportIdentity struct {
	Counts               Counts              `json:"counts"`
	SourceCounts         map[string]int      `json:"sourceCounts"`
	UnresolvedReasons    map[string]int      `json:"unresolvedReasons"`
	ExplicitTargetGroups []reportTargetGroup `json:"explicitTargetGroups"`
}

type reportTargetGroup struct {
	Target            int            `json:"target"`
	Key               string         `json:"key"`
	StateAtAuditEpoch string         `json:"stateAtAuditEpoch"`
	EvaluatedState    *reportState   `json:"evaluatedState"`
	SourceRecords     []SourceRecord `json:"sourceRecords"`
}

type reportState struct {
	Position reportVector `json:"position"`
	Velocity reportVector `json:"velocity"`
}

type reportVector struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type reportWindow struct {
	Target             int            `json:"target"`
	Requested          Window         `json:"requested"`
	DependencyCoverage WindowCoverage `json:"dependencyCoverage"`
	Gaps               []WindowGap    `json:"gaps"`
	Meaning            string         `json:"meaning"`
}

func validateReport(report reportFile, cat *catalog.Catalog, inv *inventory.Inventory) error {
	if report.SchemaVersion != 1 || report.Purpose != "source-identity-and-dependency-window-audit" {
		return fmt.Errorf("unsupported coverage report schema or purpose")
	}
	if !report.SourceBytesVerified || !validHash(report.InputInventorySHA256) || !validHash(report.SourceSnapshotSHA256) || !validHash(report.Kernels.ManifestSHA256) || !validHash(report.Kernels.IdentityMappingSHA256) || !validHash(report.Kernels.SatelliteCatalogSHA256) {
		return fmt.Errorf("coverage report integrity evidence is incomplete")
	}
	if report.InputInventorySHA256 != inv.ManifestHash() || report.Identity.Counts.SourceRecords != inv.TotalRecords() || report.Kernels.ManifestSHA256 != cat.ManifestHash() {
		return fmt.Errorf("coverage report does not match current inventory or SPK manifest")
	}
	if report.Kernels.ManifestID != cat.Version() || report.Kernels.Profile != "full" || report.Kernels.Profile != cat.ManifestProfile() {
		return fmt.Errorf("coverage report SPK identity/profile does not match current catalog")
	}
	if report.Kernels.TimeScale != "TDB seconds past J2000" || report.Kernels.Frame != "ECLIPJ2000" || report.Kernels.PositionUnit != "km" || report.Kernels.VelocityUnit != "km/s" {
		return fmt.Errorf("coverage report scientific reference is unsupported")
	}
	if !finite(report.Kernels.AuditET) || !finite(report.RequestedWindow.StartET) || !finite(report.RequestedWindow.EndET) || report.RequestedWindow.StartET > report.RequestedWindow.EndET || report.RequestedWindow.TimeScale != "TDB seconds past J2000" {
		return fmt.Errorf("coverage report epoch/window is invalid")
	}
	if report.WindowCounts.NumericallyCertifiedWholeWindowTargets != nil {
		return fmt.Errorf("coverage report contains unsupported whole-window numerical certification")
	}
	if err := validateCounts(report); err != nil {
		return err
	}
	if len(report.Identity.ExplicitTargetGroups) < 1 || len(report.Identity.ExplicitTargetGroups) > maxTargetGroups || len(report.Windows) != len(report.Identity.ExplicitTargetGroups) {
		return fmt.Errorf("coverage report target/window counts are invalid")
	}
	groups := make(map[int]reportTargetGroup, len(report.Identity.ExplicitTargetGroups))
	refs := make(map[string]SourceRecord, report.Identity.Counts.MappedSourceRecords)
	refTargets := make(map[string]int, report.Identity.Counts.MappedSourceRecords)
	ordinals := make(map[int]struct{}, report.Identity.Counts.MappedSourceRecords)
	for _, group := range report.Identity.ExplicitTargetGroups {
		available := group.StateAtAuditEpoch == "state-available-at-audit-epoch"
		missing := group.StateAtAuditEpoch == "no-state-at-audit-epoch"
		if group.Key != "naif:"+strconv.Itoa(group.Target) || (!available && !missing) ||
			(available && (group.EvaluatedState == nil || !finiteState(*group.EvaluatedState))) ||
			(missing && group.EvaluatedState != nil) || len(group.SourceRecords) < 1 || len(group.SourceRecords) > maxSourceRefs {
			return fmt.Errorf("coverage report target group %d is invalid", group.Target)
		}
		body, ok := cat.Get(group.Key)
		if (ok && body.NAIFID != group.Target) || (available && (!ok || body.Availability != catalog.AvailableOperational)) {
			return fmt.Errorf("coverage report target %d does not match current catalog", group.Target)
		}
		if _, exists := groups[group.Target]; exists {
			return fmt.Errorf("coverage report repeats target %d", group.Target)
		}
		groups[group.Target] = group
		for _, ref := range group.SourceRecords {
			if ref.ID == "" || ref.Source == "" || ref.SourceRow < 0 || ref.Ordinal < 0 || ref.Ordinal >= report.Identity.Counts.SourceRecords {
				return fmt.Errorf("coverage report source reference for target %d is invalid", group.Target)
			}
			if _, exists := refs[ref.ID]; exists {
				return fmt.Errorf("coverage report repeats source identity %q", ref.ID)
			}
			if _, exists := ordinals[ref.Ordinal]; exists {
				return fmt.Errorf("coverage report repeats source ordinal %d", ref.Ordinal)
			}
			refs[ref.ID] = ref
			refTargets[ref.ID] = group.Target
			ordinals[ref.Ordinal] = struct{}{}
		}
	}
	if len(refs) != report.Identity.Counts.MappedSourceRecords || len(refs) > maxSourceRefsTotal {
		return fmt.Errorf("coverage report mapped source count does not match references")
	}
	rows, actualOrdinals, err := inv.GetManyWithOrdinals(context.Background(), mapKeys(refs))
	if err != nil {
		return fmt.Errorf("verify coverage source references: %w", err)
	}
	if len(rows) != len(refs) {
		return fmt.Errorf("coverage report references missing current inventory rows")
	}
	for id, ref := range refs {
		record, err := inventory.Decode(rows[id])
		if err != nil || record.ID != id || actualOrdinals[id] != ref.Ordinal || record.NAIFID != refTargets[ref.ID] || record.Source != ref.Source || record.SourceRow != ref.SourceRow {
			return fmt.Errorf("coverage report source reference %q does not match current inventory", id)
		}
	}
	windows := make(map[int]reportWindow, len(report.Windows))
	for _, window := range report.Windows {
		if _, exists := windows[window.Target]; exists {
			return fmt.Errorf("coverage report repeats window target %d", window.Target)
		}
		group, exists := groups[window.Target]
		if !exists || window.Requested.StartET != report.RequestedWindow.StartET || window.Requested.EndET != report.RequestedWindow.EndET {
			return fmt.Errorf("coverage report window target %d is not identity-matched", window.Target)
		}
		if err := validateWindow(window, report.RequestedWindow); err != nil {
			return fmt.Errorf("coverage report window target %d: %w", window.Target, err)
		}
		if len(group.SourceRecords) == 0 && group.StateAtAuditEpoch == "state-available-at-audit-epoch" {
			return fmt.Errorf("available target %d has no mapped source record", window.Target)
		}
		windows[window.Target] = window
	}
	return nil
}

func validateCounts(report reportFile) error {
	c := report.Identity.Counts
	if c.SourceRecords < 0 || c.MappedSourceRecords < 0 || c.UnresolvedSourceRecords < 0 || c.ExplicitNAIFTargets < 0 || c.AvailableTargetsAtAuditET < 0 || c.MappedSourceRecords > c.SourceRecords || c.MappedSourceRecords > maxSourceRefsTotal || c.ExplicitNAIFTargets > c.MappedSourceRecords || c.ExplicitNAIFTargets > maxTargetGroups || c.UnresolvedSourceRecords != c.SourceRecords-c.MappedSourceRecords || c.ExplicitNAIFTargets != len(report.Identity.ExplicitTargetGroups) {
		return fmt.Errorf("coverage report identity counts are inconsistent")
	}
	sourceTotal := 0
	for _, count := range report.Identity.SourceCounts {
		if count < 0 || count > c.SourceRecords-sourceTotal {
			return fmt.Errorf("coverage report source count is negative")
		}
		sourceTotal += count
	}
	if sourceTotal != c.SourceRecords {
		return fmt.Errorf("coverage report source counts do not reconcile")
	}
	reasonTotal := 0
	if len(report.Identity.UnresolvedReasons) > maxSummaryReasons {
		return fmt.Errorf("coverage report has too many unresolved reasons")
	}
	for reason := range report.Identity.UnresolvedReasons {
		if !validReason(reason) {
			return fmt.Errorf("coverage report has invalid unresolved reason")
		}
	}
	for _, count := range report.Identity.UnresolvedReasons {
		if count < 0 || count > c.UnresolvedSourceRecords-reasonTotal {
			return fmt.Errorf("coverage report unresolved count is negative")
		}
		reasonTotal += count
	}
	if reasonTotal != c.UnresolvedSourceRecords {
		return fmt.Errorf("coverage report unresolved reasons do not reconcile")
	}
	covered, gaps, available := 0, 0, 0
	for _, group := range report.Identity.ExplicitTargetGroups {
		if group.StateAtAuditEpoch == "state-available-at-audit-epoch" {
			available++
		}
	}
	for _, window := range report.Windows {
		if len(window.Gaps) == 0 {
			covered++
		} else {
			gaps++
		}
	}
	if available != c.AvailableTargetsAtAuditET || covered != report.WindowCounts.DependencyCoveredTargets || gaps != report.WindowCounts.TargetsWithDependencyGaps || covered+gaps != c.ExplicitNAIFTargets {
		return fmt.Errorf("coverage report window counts do not reconcile")
	}
	return nil
}

func validateWindow(window reportWindow, requested Window) error {
	if window.Meaning == "" || !strings.Contains(strings.ToLower(window.Meaning), "dependency") {
		return fmt.Errorf("dependency meaning is missing")
	}
	points := window.DependencyCoverage.Points
	intervals := window.DependencyCoverage.Intervals
	if len(points) < 1 || len(points) > maxWindowAtoms || len(intervals) != len(points)-1 || len(window.Gaps) > maxWindowAtoms {
		return fmt.Errorf("window atom count is invalid")
	}
	pointKeys := make(map[string]struct{}, len(points))
	for n, point := range points {
		if !finite(point.ET) || point.ET < requested.StartET || point.ET > requested.EndET || (n > 0 && point.ET <= points[n-1].ET) || !validateAtomState(point.State) || (point.State == "gap" && point.Reason == "") || (point.State == "covered" && point.Reason != "") {
			return fmt.Errorf("invalid point atom")
		}
		key := atomKey("point", point.ET, point.ET, point.Reason)
		if _, exists := pointKeys[key]; exists {
			return fmt.Errorf("duplicate point atom")
		}
		pointKeys[key] = struct{}{}
		if err := validateChain(point.Chain); err != nil {
			return err
		}
	}
	if points[0].ET != requested.StartET || points[len(points)-1].ET != requested.EndET {
		return fmt.Errorf("point atoms do not include window boundaries")
	}
	intervalKeys := make(map[string]struct{}, len(intervals))
	for n, interval := range intervals {
		if interval.StartET != points[n].ET || interval.EndET != points[n+1].ET {
			return fmt.Errorf("interval atoms do not follow adjacent boundary points")
		}
		if !finite(interval.StartET) || !finite(interval.EndET) || interval.StartET >= interval.EndET || interval.StartET < requested.StartET || interval.EndET > requested.EndET || interval.Openness != "(start,end)" || !validateAtomState(interval.State) || (interval.State == "gap" && interval.Reason == "") || (interval.State == "covered" && interval.Reason != "") {
			return fmt.Errorf("invalid interval atom")
		}
		if n > 0 && interval.StartET != intervals[n-1].EndET {
			return fmt.Errorf("interval atoms do not partition the requested window")
		}
		if n == 0 && interval.StartET != requested.StartET || n == len(intervals)-1 && interval.EndET != requested.EndET {
			return fmt.Errorf("interval atoms do not include window boundaries")
		}
		key := atomKey("interval", interval.StartET, interval.EndET, interval.Reason)
		if _, exists := intervalKeys[key]; exists {
			return fmt.Errorf("duplicate interval atom")
		}
		intervalKeys[key] = struct{}{}
		if err := validateChain(interval.Chain); err != nil {
			return err
		}
	}
	for _, interval := range intervals {
		if _, ok := findPoint(points, interval.StartET); !ok {
			return fmt.Errorf("interval start has no boundary point")
		}
		if _, ok := findPoint(points, interval.EndET); !ok {
			return fmt.Errorf("interval end has no boundary point")
		}
	}
	gapAtoms := make(map[string]int)
	for _, point := range points {
		if point.State == "gap" {
			gapAtoms[atomKey("point", point.ET, point.ET, point.Reason)]++
		}
	}
	for _, interval := range intervals {
		if interval.State == "gap" {
			gapAtoms[atomKey("interval", interval.StartET, interval.EndET, interval.Reason)]++
		}
	}
	for _, gap := range window.Gaps {
		key, err := gapKey(gap, requested)
		if err != nil {
			return err
		}
		if gapAtoms[key] == 0 {
			return fmt.Errorf("reported gap has no matching atom")
		}
		gapAtoms[key]--
	}
	for _, count := range gapAtoms {
		if count != 0 {
			return fmt.Errorf("window gap atoms are not fully reported")
		}
	}
	return nil
}

func validateChain(chain []ChainStep) error {
	if len(chain) > maxChainSteps {
		return fmt.Errorf("dependency chain is too long")
	}
	for _, step := range chain {
		if step.Target == nil && step.Origin == "" || step.Context == "" && step.Origin == "" {
			return fmt.Errorf("dependency chain step is incomplete")
		}
		if step.Origin != "" && !strings.HasPrefix(step.Origin, "naif:") {
			return fmt.Errorf("dependency chain origin is invalid")
		}
		if step.KernelID != "" {
			if step.Target == nil || step.Frame == nil || *step.Frame != 1 || step.Type == nil || (*step.Type != 2 && *step.Type != 3 && *step.Type != 17 && *step.Type != 21) || step.StartET == nil || step.EndET == nil || !finite(*step.StartET) || !finite(*step.EndET) || *step.StartET > *step.EndET {
				return fmt.Errorf("kernel dependency chain step is invalid")
			}
		} else if step.StartET != nil || step.EndET != nil || step.Frame != nil || step.Type != nil {
			return fmt.Errorf("non-kernel dependency chain step has kernel fields")
		}
	}
	return nil
}

func validateAtomState(value string) bool { return value == "covered" || value == "gap" }
func validReason(value string) bool {
	if len(value) < 1 || len(value) > 128 || !asciiLowerDigit(value[0]) {
		return false
	}
	for n := 1; n < len(value); n++ {
		if !asciiLowerDigit(value[n]) && value[n] != '-' {
			return false
		}
	}
	return true
}
func asciiLowerDigit(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= '0' && value <= '9'
}
func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }
func finiteState(value reportState) bool {
	return finite(value.Position.X) && finite(value.Position.Y) && finite(value.Position.Z) && finite(value.Velocity.X) && finite(value.Velocity.Y) && finite(value.Velocity.Z)
}
func validHash(value string) bool {
	if len(value) != sha256.Size*2 || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
func atomKey(kind string, start, end float64, reason string) string {
	return kind + ":" + strconv.FormatFloat(start, 'g', -1, 64) + ":" + strconv.FormatFloat(end, 'g', -1, 64) + ":" + reason
}
func findPoint(points []WindowPoint, value float64) (WindowPoint, bool) {
	for _, point := range points {
		if point.ET == value {
			return point, true
		}
	}
	return WindowPoint{}, false
}
func gapKey(gap WindowGap, requested Window) (string, error) {
	if gap.Reason == "" || len(gap.Chain) > maxChainSteps {
		return "", fmt.Errorf("invalid reported gap")
	}
	if err := validateChain(gap.Chain); err != nil {
		return "", err
	}
	switch gap.Kind {
	case "point":
		if gap.ET == nil || gap.StartET != nil || gap.EndET != nil || !finite(*gap.ET) || *gap.ET < requested.StartET || *gap.ET > requested.EndET {
			return "", fmt.Errorf("invalid point gap")
		}
		return atomKey("point", *gap.ET, *gap.ET, gap.Reason), nil
	case "interval":
		if gap.ET != nil || gap.StartET == nil || gap.EndET == nil || !finite(*gap.StartET) || !finite(*gap.EndET) || *gap.StartET >= *gap.EndET || *gap.StartET < requested.StartET || *gap.EndET > requested.EndET {
			return "", fmt.Errorf("invalid interval gap")
		}
		return atomKey("interval", *gap.StartET, *gap.EndET, gap.Reason), nil
	default:
		return "", fmt.Errorf("invalid gap kind")
	}
}
func mapKeys(values map[string]SourceRecord) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
func cloneCounts(values map[string]int) map[string]int {
	out := make(map[string]int, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}
func cloneWindowCoverage(value WindowCoverage) WindowCoverage {
	points := value.Points
	value.Points = make([]WindowPoint, len(points))
	for n, point := range points {
		value.Points[n] = point
		value.Points[n].Chain = cloneChain(point.Chain)
	}
	intervals := value.Intervals
	value.Intervals = make([]WindowInterval, len(intervals))
	for n, interval := range intervals {
		value.Intervals[n] = interval
		value.Intervals[n].Chain = cloneChain(interval.Chain)
	}
	gaps := value.Gaps
	value.Gaps = make([]WindowGap, len(gaps))
	for n, gap := range gaps {
		value.Gaps[n] = gap
		value.Gaps[n].Chain = cloneChain(gap.Chain)
		value.Gaps[n].ET = cloneFloat(gap.ET)
		value.Gaps[n].StartET = cloneFloat(gap.StartET)
		value.Gaps[n].EndET = cloneFloat(gap.EndET)
	}
	return value
}

func validateExplicitFields(raw []byte) error {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil {
		return fmt.Errorf("parse coverage report fields: %w", err)
	}
	kernels, err := requiredObject(root, "kernels")
	if err != nil {
		return err
	}
	if err := requiredNonNull(kernels, "auditEt"); err != nil {
		return fmt.Errorf("kernels: %w", err)
	}
	requested, err := requiredObject(root, "requestedWindow")
	if err != nil {
		return err
	}
	for _, name := range []string{"startEt", "endEt"} {
		if err := requiredNonNull(requested, name); err != nil {
			return fmt.Errorf("requestedWindow: %w", err)
		}
	}
	windowCounts, err := requiredObject(root, "windowCounts")
	if err != nil {
		return err
	}
	numeric, ok := windowCounts["numericallyCertifiedWholeWindowTargets"]
	if !ok || !bytes.Equal(bytes.TrimSpace(numeric), []byte("null")) {
		return fmt.Errorf("windowCounts.numericallyCertifiedWholeWindowTargets must be explicit null")
	}
	for _, name := range []string{"dependencyCoveredTargets", "targetsWithDependencyGaps"} {
		if err := requiredNonNull(windowCounts, name); err != nil {
			return err
		}
	}
	identity, err := requiredObject(root, "identity")
	if err != nil {
		return err
	}
	counts, err := requiredObject(identity, "counts")
	if err != nil {
		return err
	}
	for _, name := range []string{"sourceRecords", "mappedSourceRecords", "unresolvedSourceRecords", "explicitNaifTargets", "availableTargetsAtAuditEpoch"} {
		if err := requiredNonNull(counts, name); err != nil {
			return err
		}
	}
	groups, err := requiredArray(root, "identity", "explicitTargetGroups")
	if err != nil {
		return err
	}
	for n, groupRaw := range groups {
		group, err := object(groupRaw)
		if err != nil {
			return fmt.Errorf("identity.explicitTargetGroups[%d]: %w", n, err)
		}
		if err := requiredNonNull(group, "target"); err != nil {
			return err
		}
		refs, err := requiredArrayValue(group, "sourceRecords")
		if err != nil {
			return err
		}
		for _, rawRef := range refs {
			ref, err := object(rawRef)
			if err != nil {
				return err
			}
			for _, name := range []string{"ordinal", "sourceRow"} {
				if err := requiredNonNull(ref, name); err != nil {
					return err
				}
			}
		}
		var status string
		_ = json.Unmarshal(group["stateAtAuditEpoch"], &status)
		if status == "no-state-at-audit-epoch" {
			state, exists := group["evaluatedState"]
			if !exists || !bytes.Equal(bytes.TrimSpace(state), []byte("null")) {
				return fmt.Errorf("unavailable target must have explicit null evaluatedState")
			}
			continue
		}
		state, err := requiredObject(group, "evaluatedState")
		if err != nil {
			return fmt.Errorf("identity.explicitTargetGroups[%d]: %w", n, err)
		}
		for _, vectorName := range []string{"position", "velocity"} {
			vector, err := requiredObject(state, vectorName)
			if err != nil {
				return fmt.Errorf("identity.explicitTargetGroups[%d].evaluatedState: %w", n, err)
			}
			for _, component := range []string{"x", "y", "z"} {
				if err := requiredNonNull(vector, component); err != nil {
					return fmt.Errorf("identity.explicitTargetGroups[%d].evaluatedState.%s: %w", n, vectorName, err)
				}
			}
		}
	}
	windows, err := requiredArrayValue(root, "windows")
	if err != nil {
		return err
	}
	for n, windowRaw := range windows {
		window, err := object(windowRaw)
		if err != nil {
			return fmt.Errorf("windows[%d]: %w", n, err)
		}
		windowRequested, err := requiredObject(window, "requested")
		if err != nil {
			return fmt.Errorf("windows[%d]: %w", n, err)
		}
		for _, name := range []string{"startEt", "endEt"} {
			if err := requiredNonNull(windowRequested, name); err != nil {
				return fmt.Errorf("windows[%d].requested: %w", n, err)
			}
		}
		dependency, err := requiredObject(window, "dependencyCoverage")
		if err != nil {
			return fmt.Errorf("windows[%d]: %w", n, err)
		}
		points, err := requiredArrayValue(dependency, "points")
		if err != nil {
			return fmt.Errorf("windows[%d].dependencyCoverage: %w", n, err)
		}
		for pointN, pointRaw := range points {
			point, err := object(pointRaw)
			if err != nil {
				return fmt.Errorf("windows[%d].points[%d]: %w", n, pointN, err)
			}
			if err := requiredNonNull(point, "et"); err != nil {
				return fmt.Errorf("windows[%d].points[%d]: %w", n, pointN, err)
			}
		}
		intervals, err := requiredArrayValue(dependency, "intervals")
		if err != nil {
			return fmt.Errorf("windows[%d].dependencyCoverage: %w", n, err)
		}
		for intervalN, intervalRaw := range intervals {
			interval, err := object(intervalRaw)
			if err != nil {
				return fmt.Errorf("windows[%d].intervals[%d]: %w", n, intervalN, err)
			}
			for _, name := range []string{"startEt", "endEt"} {
				if err := requiredNonNull(interval, name); err != nil {
					return fmt.Errorf("windows[%d].intervals[%d]: %w", n, intervalN, err)
				}
			}
		}
		gaps, err := requiredArrayValue(window, "gaps")
		if err != nil {
			return fmt.Errorf("windows[%d]: %w", n, err)
		}
		for gapN, gapRaw := range gaps {
			gap, err := object(gapRaw)
			if err != nil {
				return fmt.Errorf("windows[%d].gaps[%d]: %w", n, gapN, err)
			}
			var gapFields []string
			var gapKind string
			if value, ok := gap["kind"]; ok {
				_ = json.Unmarshal(value, &gapKind)
			}
			if gapKind == "point" {
				gapFields = []string{"et"}
			} else if gapKind == "interval" {
				gapFields = []string{"startEt", "endEt"}
			} else {
				return fmt.Errorf("windows[%d].gaps[%d] has invalid kind", n, gapN)
			}
			for _, name := range gapFields {
				if err := requiredNonNull(gap, name); err != nil {
					return fmt.Errorf("windows[%d].gaps[%d]: %w", n, gapN, err)
				}
			}
		}
	}
	return nil
}

func object(raw json.RawMessage) (map[string]json.RawMessage, error) {
	var value map[string]json.RawMessage
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return nil, fmt.Errorf("expected JSON object")
	}
	return value, nil
}

func requiredObject(value map[string]json.RawMessage, name string) (map[string]json.RawMessage, error) {
	raw, ok := value[name]
	if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, fmt.Errorf("missing required object %q", name)
	}
	return object(raw)
}

func requiredArray(value map[string]json.RawMessage, parent, name string) ([]json.RawMessage, error) {
	parentValue, err := requiredObject(value, parent)
	if err != nil {
		return nil, err
	}
	return requiredArrayValue(parentValue, name)
}

func requiredArrayValue(value map[string]json.RawMessage, name string) ([]json.RawMessage, error) {
	raw, ok := value[name]
	if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, fmt.Errorf("missing required array %q", name)
	}
	var out []json.RawMessage
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("field %q is not an array", name)
	}
	return out, nil
}

func requiredNonNull(value map[string]json.RawMessage, name string) error {
	raw, ok := value[name]
	if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return fmt.Errorf("missing required field %q", name)
	}
	return nil
}

func cloneChain(value []ChainStep) []ChainStep {
	out := make([]ChainStep, len(value))
	for n, step := range value {
		out[n] = step
		out[n].Target = cloneInt(step.Target)
		out[n].Center = cloneInt(step.Center)
		out[n].Frame = cloneInt(step.Frame)
		out[n].Type = cloneInt(step.Type)
		out[n].StartET = cloneFloat(step.StartET)
		out[n].EndET = cloneFloat(step.EndET)
	}
	return out
}

func cloneInt(value *int) *int {
	if value == nil {
		return nil
	}
	out := *value
	return &out
}

func cloneFloat(value *float64) *float64 {
	if value == nil {
		return nil
	}
	out := *value
	return &out
}
