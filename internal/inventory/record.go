package inventory

import (
	"context"
	"encoding/json"
	"fmt"
)

// Record is the subset of a source row used for the current identity and state
// resolution contract. Callers that need source-specific evidence should keep
// the original Raw JSON returned by Page or Get.
type Record struct {
	ID              string          `json:"id"`
	Designation     string          `json:"designation"`
	Name            string          `json:"name"`
	Category        string          `json:"category"`
	ParentID        string          `json:"parentId"`
	Confirmation    string          `json:"confirmation"`
	IdentityStatus  string          `json:"identityStatus"`
	GeometryStatus  string          `json:"geometryStatus"`
	EphemerisStatus string          `json:"ephemerisStatus"`
	Source          string          `json:"source"`
	SourceRef       json.RawMessage `json:"sourceRef"`
	SourceRow       int             `json:"sourceRow"`
	NAIFID          int             `json:"naifId"`
	Aliases         []string        `json:"aliases"`
	Orbit           *Orbit          `json:"orbit"`
	KernelEvidence  *KernelEvidence `json:"kernelEvidence"`
}

type Orbit struct {
	TimeScale           string   `json:"timeScale"`
	Frame               string   `json:"frame"`
	Center              string   `json:"center"`
	EpochJD             *float64 `json:"epochJd"`
	SemiMajorAxisAU     *float64 `json:"semiMajorAxisAU"`
	PerihelionAU        *float64 `json:"perihelionAU"`
	MeanAnomalyDeg      *float64 `json:"meanAnomalyDeg"`
	Eccentricity        *float64 `json:"eccentricity"`
	InclinationDeg      *float64 `json:"inclinationDeg"`
	ArgPeriapsisDeg     *float64 `json:"argPeriapsisDeg"`
	AscendingNodeDeg    *float64 `json:"ascendingNodeDeg"`
	MeanMotionDegPerDay *float64 `json:"meanMotionDegPerDay"`
}

type KernelEvidence struct {
	AuditET           float64         `json:"auditEt"`
	Target            int             `json:"target"`
	Segments          []KernelSegment `json:"segments"`
	StateAtAuditEpoch *EvidenceState  `json:"stateAtAuditEpoch"`
}

type KernelSegment struct {
	KernelID string  `json:"kernelId"`
	StartET  float64 `json:"startEt"`
	EndET    float64 `json:"endEt"`
	Center   int     `json:"center"`
	Frame    int     `json:"frame"`
	Type     int     `json:"type"`
}

type EvidenceState struct {
	Position Vector `json:"position"`
	Velocity Vector `json:"velocity"`
}

type Vector struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// IdentitySummary is a source identity assertion, not a deduplicated body.
// Resolution fields only report explicit source IDs or an index match; they do
// not infer aliases, barycentres, or parent relationships.
type IdentitySummary struct {
	ID               string   `json:"id"`
	Designation      string   `json:"designation,omitempty"`
	Name             string   `json:"name,omitempty"`
	Category         string   `json:"category"`
	ParentID         string   `json:"parentId,omitempty"`
	ParentResolution string   `json:"parentResolution"`
	CenterID         string   `json:"centerId,omitempty"`
	CenterResolution string   `json:"centerResolution,omitempty"`
	Aliases          []string `json:"aliases,omitempty"`
	Confirmation     string   `json:"confirmation"`
	IdentityStatus   string   `json:"identityStatus"`
	GeometryStatus   string   `json:"geometryStatus"`
	EphemerisStatus  string   `json:"ephemerisStatus"`
	Source           string   `json:"source"`
	SourceRow        int      `json:"sourceRow"`
	NAIFID           int      `json:"naifId,omitempty"`
	IdentityEvidence []string `json:"identityEvidence"`
}

func Decode(raw json.RawMessage) (Record, error) {
	var record Record
	if err := json.Unmarshal(raw, &record); err != nil {
		return Record{}, fmt.Errorf("parse source record: %w", err)
	}
	if record.ID == "" {
		return Record{}, fmt.Errorf("source record has no stable id")
	}
	return record, nil
}

func (i *Inventory) HasID(id string) bool {
	if i == nil || i.idx == nil || id == "" {
		return false
	}
	hash := hashText(normalize(id))
	for _, posting := range i.postings(hash) {
		if posting&idPostingBit != 0 {
			return true
		}
	}
	return false
}

func (i *Inventory) IdentityPage(ctx context.Context, cursor, query string, limit int) ([]IdentitySummary, string, error) {
	rows, next, err := i.Page(ctx, cursor, query, limit)
	if err != nil {
		return nil, "", err
	}
	items := make([]IdentitySummary, 0, len(rows))
	for _, raw := range rows {
		record, err := Decode(raw)
		if err != nil {
			return nil, "", err
		}
		items = append(items, i.Summary(record))
	}
	return items, next, nil
}

func (i *Inventory) Summary(record Record) IdentitySummary {
	parentResolution := "not-declared"
	if record.ParentID != "" {
		parentResolution = "missing"
		if i.HasID(record.ParentID) {
			parentResolution = "index-match"
		}
	}
	centerID, centerResolution := "", ""
	if record.Orbit != nil && record.Orbit.Center != "" {
		centerID = record.Orbit.Center
		centerResolution = "missing"
		if i.HasID(centerID) {
			centerResolution = "index-match"
		}
	}
	evidence := []string{"source-id"}
	if record.Designation != "" {
		evidence = append(evidence, "source-designation")
	}
	if len(record.Aliases) > 0 {
		evidence = append(evidence, "source-aliases")
	}
	if record.ParentID != "" {
		evidence = append(evidence, "source-parent")
	}
	if centerID != "" {
		evidence = append(evidence, "source-center")
	}
	return IdentitySummary{ID: record.ID, Designation: record.Designation, Name: record.Name, Category: record.Category, ParentID: record.ParentID, ParentResolution: parentResolution, CenterID: centerID, CenterResolution: centerResolution, Aliases: append([]string(nil), record.Aliases...), Confirmation: record.Confirmation, IdentityStatus: record.IdentityStatus, GeometryStatus: record.GeometryStatus, EphemerisStatus: record.EphemerisStatus, Source: record.Source, SourceRow: record.SourceRow, NAIFID: record.NAIFID, IdentityEvidence: evidence}
}
