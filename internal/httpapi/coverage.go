package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/coverage"
)

const maxCoverageQueryIDs = 64
const maxCoverageTargetResponseBytes = 16 << 20

type coverageSummaryResponse struct {
	APIVersion string `json:"apiVersion"`
	coverage.Summary
}

type coverageTargetResponse struct {
	RequestedID string                   `json:"requestedId"`
	CanonicalID string                   `json:"canonicalId,omitempty"`
	Target      *int                     `json:"target,omitempty"`
	Status      string                   `json:"status"`
	Coverage    *coverage.TargetCoverage `json:"coverage,omitempty"`
}

func (s *Server) coverageSummary(w http.ResponseWriter, _ *http.Request) {
	if s.coverage == nil {
		s.error(w, http.StatusNotFound, "coverage_unavailable", "coverage audit is not configured for this service")
		return
	}
	s.json(w, http.StatusOK, coverageSummaryResponse{APIVersion: catalog.APIVersion, Summary: s.coverage.Summary()})
}

func (s *Server) coverageTargets(w http.ResponseWriter, r *http.Request) {
	if s.coverage == nil {
		s.error(w, http.StatusNotFound, "coverage_unavailable", "coverage audit is not configured for this service")
		return
	}
	value := r.URL.Query().Get("ids")
	if value == "" || len(value) > 4096 {
		s.error(w, http.StatusBadRequest, "invalid_coverage_ids", "ids must contain at most 64 catalog identities")
		return
	}
	ids := make([]string, 0, maxCoverageQueryIDs)
	seen := make(map[string]struct{}, maxCoverageQueryIDs)
	for _, part := range strings.Split(value, ",") {
		id := strings.TrimSpace(part)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
		if len(ids) > maxCoverageQueryIDs {
			s.error(w, http.StatusBadRequest, "coverage_query_too_large", "ids must contain at most 64 distinct catalog identities")
			return
		}
	}
	if len(ids) == 0 {
		s.error(w, http.StatusBadRequest, "invalid_coverage_ids", "ids must contain at least one catalog identity")
		return
	}
	summary := s.coverage.Summary()
	// Keep one owned ledger copy per target, including negative lookups. Aliases
	// remain separate response rows without multiplying large dependency graphs.
	lookups := make(map[int]*coverage.TargetCoverage)
	lookup := func(id int) *coverage.TargetCoverage {
		if target, exists := lookups[id]; exists {
			return target
		}
		target, found := s.coverage.Lookup(id)
		if !found {
			lookups[id] = nil
			return nil
		}
		lookups[id] = &target
		return &target
	}
	rows := make([]json.RawMessage, 0, len(ids))
	rowBytes := 2 // Array brackets; final envelope is checked by jsonLimited.
	for _, id := range ids {
		if r.Context().Err() != nil {
			return
		}
		row := coverageTargetResponse{RequestedID: id, Status: "not_audited"}
		body, ok := s.catalog.Get(id)
		targetID, hasTarget := body.NAIFID, ok && body.NAIFID != 0
		if !hasTarget && strings.HasPrefix(id, "naif:") {
			parsed, err := strconv.Atoi(strings.TrimPrefix(id, "naif:"))
			if err == nil && id == "naif:"+strconv.Itoa(parsed) {
				hasTarget = lookup(parsed) != nil
				targetID = parsed
			}
		}
		if hasTarget {
			canonicalID := "naif:" + strconv.Itoa(targetID)
			row.CanonicalID = canonicalID
			row.Target = &targetID
			if target := lookup(targetID); target != nil {
				row.Status = "audited"
				row.Coverage = target
			}
		}
		encoded, err := json.Marshal(row)
		if err != nil {
			s.error(w, http.StatusInternalServerError, "encode_response", "coverage target could not be encoded")
			return
		}
		separator := 0
		if len(rows) > 0 {
			separator = 1
		}
		if len(encoded) > maxCoverageTargetResponseBytes-rowBytes-separator {
			s.error(w, http.StatusRequestEntityTooLarge, "response_too_large", "coverage targets exceed the response budget; request fewer identities")
			return
		}
		rowBytes += len(encoded) + separator
		rows = append(rows, encoded)
	}
	if r.Context().Err() != nil {
		return
	}
	s.jsonLimited(w, http.StatusOK, map[string]any{
		"apiVersion":              catalog.APIVersion,
		"reportSha256":            summary.ReportSHA256,
		"catalogManifestSha256":   summary.CatalogManifestSHA256,
		"inventoryManifestSha256": summary.InventoryManifestSHA256,
		"auditEt":                 summary.AuditET,
		"timeScale":               summary.TimeScale,
		"frame":                   summary.Frame,
		"requestedWindow":         summary.RequestedWindow,
		"targets":                 rows,
	}, maxCoverageTargetResponseBytes)
}
