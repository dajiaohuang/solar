package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
	"github.com/dajiaohuang/solar/backend/internal/science"
)

const maxBodyBytes = 1 << 20

type Server struct {
	catalog             *catalog.Catalog
	inventory           *inventory.Inventory
	slots               chan struct{}
	tileSlots           chan struct{}
	plans               *statePlanCache
	tiles               *stateTileCache
	stateTileByteBudget int64
	inFlight            atomic.Int64
	cancelled           atomic.Uint64
}

func New(c *catalog.Catalog, maxConcurrent int, inventories ...*inventory.Inventory) *Server {
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	var inv *inventory.Inventory
	if len(inventories) > 0 {
		inv = inventories[0]
	}
	return &Server{catalog: c, inventory: inv, slots: make(chan struct{}, maxConcurrent), tileSlots: make(chan struct{}, 2), plans: newStatePlanCache(statePlanCacheItems), tiles: newStateTileCache(stateTileCacheBytes), stateTileByteBudget: maxStateTileBytes}
}

// TileCacheStats exposes bounded runtime evidence to the local benchmark
// harness without adding diagnostic state to the wire protocol.
func (s *Server) TileCacheStats() map[string]uint64 {
	if s.tiles == nil {
		return map[string]uint64{}
	}
	return s.tiles.stats()
}

// CancelledRequests reports requests whose server handler observed a canceled
// context before returning. It is benchmark evidence, not a wire metric.
func (s *Server) CancelledRequests() uint64 {
	return s.cancelled.Load()
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if r.Context().Err() != nil {
			s.cancelled.Add(1)
		}
	}()
	w.Header().Set("X-Solar-API-Version", catalog.APIVersion)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Length, ETag, X-Solar-API-Version")
	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/v1/") {
		s.error(w, http.StatusNotFound, "not_found", "unknown endpoint")
		return
	}
	// Scientific work is deliberately fail-fast when the bounded worker pool is
	// full. An unbounded wait queue would let a burst consume memory before
	// request cancellation can be observed by the handler.
	if err := r.Context().Err(); err != nil {
		s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
		return
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		w.Header().Set("Retry-After", "1")
		s.error(w, http.StatusTooManyRequests, "overloaded", "scientific worker limit reached; retry later")
		return
	}
	s.inFlight.Add(1)
	defer s.inFlight.Add(-1)
	path := strings.TrimPrefix(r.URL.Path, "/v1/")
	switch {
	case r.Method == "GET" && path == "capabilities":
		s.capabilities(w, r)
	case r.Method == "GET" && path == "catalog":
		s.catalogPage(w, r)
	case r.Method == "GET" && path == "inventory":
		s.inventoryPage(w, r)
	case r.Method == "GET" && path == "identities":
		s.identityPage(w, r)
	case r.Method == "GET" && strings.HasPrefix(path, "identities/"):
		s.identityRoute(w, r, strings.TrimPrefix(path, "identities/"))
	case r.Method == "GET" && strings.HasPrefix(path, "inventory/"):
		s.inventoryDetail(w, r, strings.TrimPrefix(path, "inventory/"))
	case r.Method == "GET" && strings.HasPrefix(path, "bodies/"):
		s.body(w, r, strings.TrimPrefix(path, "bodies/"))
	case r.Method == "POST" && path == "trajectory":
		s.trajectory(w, r)
	case r.Method == "GET" && path == "catalog/manifest":
		s.catalogManifest(w, r)
	case r.Method == "POST" && path == "state/plan":
		s.statePlan(w, r)
	case r.Method == "POST" && path == "state/tiles":
		s.stateTiles(w, r)
	case r.Method == "GET" && path == "preview/manifest":
		s.preview(w, r)
	default:
		s.error(w, http.StatusNotFound, "not_found", "unknown endpoint")
	}
}

func (s *Server) capabilities(w http.ResponseWriter, _ *http.Request) {
	coverage := map[string]any{"goal": "all-known-solar-system-bodies", "manifestProfile": s.catalog.ManifestProfile(), "manifestContract": s.catalog.ManifestContract(), "counts": s.catalog.Stats()}
	if s.inventory != nil {
		coverage["sourceInventory"] = map[string]any{"manifestSha256": s.inventory.ManifestHash(), "totalRecords": s.inventory.TotalRecords(), "compressedBytes": s.inventory.TotalBytes(), "shards": s.inventory.ShardCount(), "index": s.inventory.IndexStats(), "uniqueBodySemantics": "not-deduplicated"}
	}
	identities := s.catalog.AuditIdentityTuples()
	if s.inventory != nil {
		inventoryVersion := "inventory:" + s.inventory.ManifestHash()
		for source, models := range s.inventory.SourceIdentityModels() {
			for _, model := range models {
				identities = append(identities, map[string]string{"source": source, "datasetVersion": inventoryVersion, "model": model})
			}
		}
	}
	sort.Slice(identities, func(i, j int) bool {
		if identities[i]["source"] != identities[j]["source"] {
			return identities[i]["source"] < identities[j]["source"]
		}
		if identities[i]["datasetVersion"] != identities[j]["datasetVersion"] {
			return identities[i]["datasetVersion"] < identities[j]["datasetVersion"]
		}
		return identities[i]["model"] < identities[j]["model"]
	})
	if len(identities) > 1 {
		unique := identities[:0]
		seen := make(map[string]struct{}, len(identities))
		for _, identity := range identities {
			key := identity["source"] + "\x00" + identity["datasetVersion"] + "\x00" + identity["model"]
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			unique = append(unique, identity)
		}
		identities = unique
	}
	s.json(w, http.StatusOK, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "manifestSha256": s.catalog.ManifestHash(), "coverage": coverage, "contract": map[string]any{"timeScale": "TDB", "epoch": "Julian date", "frame": "ECLIPJ2000", "distanceUnit": "km", "velocityUnit": "km/s", "precisionModes": []string{"exact", "approximate-opt-in"}, "stateTiles": map[string]any{"precision": "exact-only", "stateOriginId": "naif:0", "fieldMask": []string{"position", "velocity"}}, "modelBoundary": "State tiles accept exact only; trajectory and identity endpoints may expose explicit approximate opt-in", "nBody": false, "auditIdentities": identities}, "limits": map[string]int{"catalogPageMax": 500, "trajectoryBodiesMax": 64, "trajectorySamplesMax": 10000, "statePlanIDsMax": maxStatePlanIDs, "stateTileBodiesMax": maxStateTileBodies, "stateTileBytesMax": maxStateTileBytes, "statePlanCacheItemsMax": statePlanCacheItems, "statePlanCacheBytesMax": statePlanCacheBytes, "inventoryPageMax": 500, "inventoryMaxIndexedRecords": inventory.MaxIndexedRecords, "inventoryMaxIndexPostings": inventory.MaxIndexPostings, "inventoryMaxShards": inventory.MaxShards, "inventoryMaxShardBytes": inventory.MaxShardBytes, "inventoryBlockRowsMax": inventory.MaxBlockRows, "inventoryBlockBytesMax": inventory.MaxBlockBytes, "inventoryBlockCacheBytesMax": inventory.BlockCacheBytes}, "profiles": map[string]any{"full": map[string]any{"catalog": true, "identities": s.inventory != nil, "trajectory": true, "stateTiles": true}, "preview": map[string]any{"catalog": "curated", "fullOnlyVisible": true, "restrictedActions": "blocked"}}})
}

func (s *Server) catalogPage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit, err := parseIntDefault(r.URL.Query().Get("limit"), 100)
	if err != nil || limit < 1 || limit > 500 {
		s.error(w, 400, "invalid_limit", "limit must be between 1 and 500")
		return
	}
	offset := 0
	token := r.URL.Query().Get("pageToken")
	if token != "" {
		b, e := base64.RawURLEncoding.DecodeString(token)
		if e != nil {
			s.error(w, 400, "invalid_page_token", "pageToken is invalid")
			return
		}
		offset, err = strconv.Atoi(string(b))
		if err != nil || offset < 0 {
			s.error(w, 400, "invalid_page_token", "pageToken is invalid")
			return
		}
	}
	items := s.catalog.Page(q, offset, limit)
	next := ""
	if len(items) == limit {
		next = base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset + len(items))))
	}
	s.json(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "items": items, "nextPageToken": next, "offset": offset, "limit": limit})
}

func (s *Server) inventoryPage(w http.ResponseWriter, r *http.Request) {
	if s.inventory == nil {
		s.error(w, http.StatusNotFound, "inventory_unavailable", "source inventory is not configured for this service")
		return
	}
	limit, err := parseIntDefault(r.URL.Query().Get("limit"), 100)
	if err != nil || limit < 1 || limit > 500 {
		s.error(w, 400, "invalid_limit", "limit must be between 1 and 500")
		return
	}
	rows, next, err := s.inventory.Page(r.Context(), r.URL.Query().Get("pageToken"), r.URL.Query().Get("q"), limit)
	if err != nil {
		if r.Context().Err() != nil {
			s.error(w, 408, "cancelled", "request cancelled")
		} else {
			s.error(w, 400, "invalid_page_token", err.Error())
		}
		return
	}
	s.json(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "inventoryManifestSha256": s.inventory.ManifestHash(), "sourceRecords": true, "uniqueBodySemantics": "not-deduplicated", "totalRecords": s.inventory.TotalRecords(), "compressedBytes": s.inventory.TotalBytes(), "shards": s.inventory.ShardCount(), "records": rows, "nextPageToken": next, "limit": limit})
}

func (s *Server) identityPage(w http.ResponseWriter, r *http.Request) {
	if s.inventory == nil {
		s.error(w, http.StatusNotFound, "inventory_unavailable", "source inventory is not configured for this service")
		return
	}
	limit, err := parseIntDefault(r.URL.Query().Get("limit"), 100)
	if err != nil || limit < 1 || limit > 500 {
		s.error(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 500")
		return
	}
	items, next, err := s.inventory.IdentityPage(r.Context(), r.URL.Query().Get("pageToken"), r.URL.Query().Get("q"), limit)
	if err != nil {
		if r.Context().Err() != nil {
			s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
		} else {
			s.error(w, http.StatusBadRequest, "invalid_page_token", err.Error())
		}
		return
	}
	s.json(w, http.StatusOK, map[string]any{
		"apiVersion":              catalog.APIVersion,
		"catalogVersion":          s.catalog.Version(),
		"inventoryManifestSha256": s.inventory.ManifestHash(),
		"sourceRecords":           true,
		"identityAssertions":      true,
		"uniqueBodySemantics":     "not-deduplicated",
		"totalRecords":            s.inventory.TotalRecords(),
		"items":                   items,
		"nextPageToken":           next,
		"limit":                   limit,
	})
}

func (s *Server) identityRoute(w http.ResponseWriter, r *http.Request, id string) {
	if s.inventory == nil {
		s.error(w, http.StatusNotFound, "inventory_unavailable", "source inventory is not configured for this service")
		return
	}
	if strings.HasSuffix(id, "/state") {
		s.identityState(w, r, strings.TrimSuffix(id, "/state"))
		return
	}
	s.identityDetail(w, r, id)
}

func (s *Server) identityDetail(w http.ResponseWriter, r *http.Request, id string) {
	if id == "" {
		s.error(w, http.StatusBadRequest, "invalid_identity_id", "identity id must not be empty")
		return
	}
	raw, found, err := s.inventory.Get(r.Context(), id)
	if err != nil {
		if r.Context().Err() != nil {
			s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
		} else {
			s.error(w, http.StatusUnprocessableEntity, "inventory_unavailable", err.Error())
		}
		return
	}
	if !found {
		s.error(w, http.StatusNotFound, "identity_not_found", "unknown source identity")
		return
	}
	record, err := inventory.Decode(raw)
	if err != nil {
		s.error(w, http.StatusUnprocessableEntity, "invalid_source_record", err.Error())
		return
	}
	s.json(w, http.StatusOK, map[string]any{
		"apiVersion":              catalog.APIVersion,
		"catalogVersion":          s.catalog.Version(),
		"inventoryManifestSha256": s.inventory.ManifestHash(),
		"sourceRecords":           true,
		"identity":                s.inventory.Summary(record),
		"record":                  json.RawMessage(raw),
	})
}

func (s *Server) inventoryDetail(w http.ResponseWriter, r *http.Request, id string) {
	if s.inventory == nil {
		s.error(w, http.StatusNotFound, "inventory_unavailable", "source inventory is not configured for this service")
		return
	}
	if id == "" {
		s.error(w, http.StatusBadRequest, "invalid_identity_id", "identity id must not be empty")
		return
	}
	raw, found, err := s.inventory.Get(r.Context(), id)
	if err != nil {
		if r.Context().Err() != nil {
			s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
		} else {
			s.error(w, http.StatusUnprocessableEntity, "inventory_unavailable", err.Error())
		}
		return
	}
	if !found {
		s.error(w, http.StatusNotFound, "identity_not_found", "unknown source identity")
		return
	}
	s.json(w, http.StatusOK, map[string]any{
		"apiVersion":              catalog.APIVersion,
		"catalogVersion":          s.catalog.Version(),
		"inventoryManifestSha256": s.inventory.ManifestHash(),
		"sourceRecords":           true,
		"record":                  json.RawMessage(raw),
	})
}

func (s *Server) body(w http.ResponseWriter, r *http.Request, id string) {
	if strings.Contains(id, "/") || id == "" {
		s.error(w, 400, "invalid_body_id", "body id must be one stable segment")
		return
	}
	b, ok := s.catalog.Get(id)
	if !ok {
		s.error(w, 404, "body_not_found", "unknown body id")
		return
	}
	s.json(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "body": b})
}

func precisionMode(value string) (bool, error) {
	if value == "" || value == "exact" {
		return false, nil
	}
	if value == "approximate" {
		return true, nil
	}
	return false, fmt.Errorf("precision must be exact or approximate")
}

func (s *Server) resolveInventoryState(ctx context.Context, record inventory.Record, jd float64, allowApproximate bool) (sourceStateResult, error) {
	return s.resolveInventoryStateWithOperational(ctx, record, jd, allowApproximate, nil, nil)
}

func (s *Server) resolveInventoryStateWithOperational(ctx context.Context, record inventory.Record, jd float64, allowApproximate bool, operational map[string]catalog.State, operationalFound map[string]bool) (sourceStateResult, error) {
	if !finite(jd) {
		return sourceStateResult{Availability: catalog.Missing, MissingReason: "invalid-epoch"}, nil
	}
	if record.NAIFID != 0 {
		catalogID := "naif:" + strconv.Itoa(record.NAIFID)
		if body, ok := s.catalog.Get(catalogID); ok && body.Availability == catalog.AvailableOperational {
			var state catalog.State
			var found bool
			var err error
			if operational != nil || operationalFound != nil {
				state, found = operational[catalogID]
				found = operationalFound[catalogID]
			} else {
				state, found, err = s.catalog.OperationalState(catalogID, jd)
			}
			if err != nil {
				return sourceStateResult{}, err
			}
			if found && finiteState(state) {
				var window map[string]float64
				if provenance, provenanceOK, provenanceErr := s.catalog.OperationalProvenance(catalogID, jd); provenanceErr != nil {
					return sourceStateResult{}, provenanceErr
				} else if provenanceOK && provenance.ValidityPresent {
					window = map[string]float64{"startEt": provenance.ValidityStartET, "endEt": provenance.ValidityEndET}
				}
				return sourceStateResult{Availability: catalog.AvailableOperational, Model: "spk-original", State: &state, Evidence: "catalog-kernel", EvidenceWindow: window}, nil
			}
		}
	}
	if record.KernelEvidence != nil && record.KernelEvidence.StateAtAuditEpoch != nil && evidenceTargetMatches(record) && evidenceWindowMatches(record) {
		auditJD := 2451545.0 + record.KernelEvidence.AuditET/86400
		if finite(auditJD) && math.Abs(jd-auditJD) < 1e-9 {
			v := record.KernelEvidence.StateAtAuditEpoch
			state := catalog.State{Position: catalog.Vec3{X: v.Position.X, Y: v.Position.Y, Z: v.Position.Z}, Velocity: catalog.Vec3{X: v.Velocity.X, Y: v.Velocity.Y, Z: v.Velocity.Z}}
			if finiteState(state) {
				return sourceStateResult{Availability: catalog.AvailableSnapshot, Model: "source-kernel-state-at-audit-epoch", State: &state, Evidence: "inventory-kernel-evidence", EvidenceWindow: matchingEvidenceWindow(record)}, nil
			}
		}
	}
	if !allowApproximate {
		return sourceStateResult{Availability: catalog.Missing, Model: "exact-only", MissingReason: missingInventoryStateReason(record)}, nil
	}
	if record.Source != "numbered" && record.Source != "unnumbered" {
		return sourceStateResult{Availability: catalog.Missing, Model: "exact-only", MissingReason: missingInventoryStateReason(record)}, nil
	}
	if record.Orbit == nil || record.Orbit.EpochJD == nil || record.Orbit.SemiMajorAxisAU == nil || record.Orbit.Eccentricity == nil || record.Orbit.InclinationDeg == nil || record.Orbit.ArgPeriapsisDeg == nil || record.Orbit.AscendingNodeDeg == nil || record.Orbit.MeanAnomalyDeg == nil {
		return sourceStateResult{Availability: catalog.Missing, Model: "approximate-opt-in", MissingReason: missingInventoryStateReason(record)}, nil
	}
	if record.Orbit.TimeScale != "TDB" || record.Orbit.Frame != "ECLIPJ2000" {
		return sourceStateResult{Availability: catalog.Missing, Model: "approximate-opt-in", MissingReason: "unvalidated-source-elements"}, nil
	}
	if !finite(*record.Orbit.EpochJD) || !finite(*record.Orbit.SemiMajorAxisAU) || !finite(*record.Orbit.Eccentricity) || !finite(*record.Orbit.InclinationDeg) || !finite(*record.Orbit.ArgPeriapsisDeg) || !finite(*record.Orbit.AscendingNodeDeg) || !finite(*record.Orbit.MeanAnomalyDeg) || *record.Orbit.SemiMajorAxisAU <= 0 {
		return sourceStateResult{Availability: catalog.Missing, Model: "approximate-opt-in", MissingReason: "unvalidated-source-elements"}, nil
	}
	if *record.Orbit.Eccentricity < 0 || *record.Orbit.Eccentricity >= 1 {
		return sourceStateResult{Availability: catalog.Missing, Model: "approximate-opt-in", MissingReason: "open-conic-not-supported"}, nil
	}
	meanMotion := 0.0
	if record.Orbit.MeanMotionDegPerDay != nil {
		if !finite(*record.Orbit.MeanMotionDegPerDay) {
			return sourceStateResult{Availability: catalog.Missing, Model: "approximate-opt-in", MissingReason: "unvalidated-source-elements"}, nil
		}
		meanMotion = *record.Orbit.MeanMotionDegPerDay
	}
	state, err := science.PropagateBoundElliptic(ctx, science.Elements{SemiMajorAxisAU: *record.Orbit.SemiMajorAxisAU, Eccentricity: *record.Orbit.Eccentricity, InclinationDeg: *record.Orbit.InclinationDeg, AscendingNodeDeg: *record.Orbit.AscendingNodeDeg, ArgPeriapsisDeg: *record.Orbit.ArgPeriapsisDeg, MeanAnomalyDeg: *record.Orbit.MeanAnomalyDeg, MeanMotionDegPerDay: meanMotion}, *record.Orbit.EpochJD, jd)
	if err != nil {
		return sourceStateResult{}, err
	}
	result := catalog.State{Position: catalog.Vec3{X: state.Position.X, Y: state.Position.Y, Z: state.Position.Z}, Velocity: catalog.Vec3{X: state.Velocity.X, Y: state.Velocity.Y, Z: state.Velocity.Z}}
	return sourceStateResult{Availability: catalog.AvailableFallback, Model: "source-elements-two-body", State: &result, Evidence: "source-elements-approximation"}, nil
}

func missingInventoryStateReason(record inventory.Record) string {
	switch {
	case record.GeometryStatus == "open-conic-elements":
		return "open-conic-not-supported"
	case strings.Contains(record.GeometryStatus, "unvalidated"):
		return "unvalidated-source-elements"
	case record.IdentityStatus == "unresolved-component":
		return "unresolved-component"
	case record.KernelEvidence != nil && record.KernelEvidence.Target != 0 && record.NAIFID != 0 && record.KernelEvidence.Target != record.NAIFID:
		return "kernel-evidence-target-mismatch"
	case record.KernelEvidence != nil && record.KernelEvidence.StateAtAuditEpoch != nil && (!evidenceTargetMatches(record) || !evidenceWindowMatches(record)):
		return "unvalidated-source-kernel-evidence"
	case record.Orbit != nil && (record.Orbit.TimeScale != "TDB" || record.Orbit.Frame != "ECLIPJ2000"):
		return "unvalidated-source-elements"
	case record.Orbit != nil:
		return "source-elements-not-exact"
	default:
		return "no-verified-state-data"
	}
}

func evidenceTargetMatches(record inventory.Record) bool {
	if record.KernelEvidence == nil || record.KernelEvidence.Target == 0 || record.NAIFID == 0 {
		return true
	}
	return record.KernelEvidence.Target == record.NAIFID
}

func evidenceWindowMatches(record inventory.Record) bool {
	if record.KernelEvidence == nil || !finite(record.KernelEvidence.AuditET) {
		return false
	}
	for _, segment := range record.KernelEvidence.Segments {
		if segment.KernelID == "" || !finite(segment.StartET) || !finite(segment.EndET) || segment.EndET < segment.StartET || segment.StartET > record.KernelEvidence.AuditET || segment.EndET < record.KernelEvidence.AuditET || segment.Frame != 1 || (segment.Type != 2 && segment.Type != 3 && segment.Type != 17 && segment.Type != 21) {
			continue
		}
		return true
	}
	return false
}

func matchingEvidenceWindow(record inventory.Record) map[string]float64 {
	if record.KernelEvidence == nil {
		return nil
	}
	for _, segment := range record.KernelEvidence.Segments {
		if segment.KernelID != "" && finite(segment.StartET) && finite(segment.EndET) && segment.EndET >= segment.StartET && segment.StartET <= record.KernelEvidence.AuditET && segment.EndET >= record.KernelEvidence.AuditET && segment.Frame == 1 && (segment.Type == 2 || segment.Type == 3 || segment.Type == 17 || segment.Type == 21) {
			return map[string]float64{"startEt": segment.StartET, "endEt": segment.EndET}
		}
	}
	return nil
}

func finiteState(state catalog.State) bool {
	for _, value := range []float64{state.Position.X, state.Position.Y, state.Position.Z, state.Velocity.X, state.Velocity.Y, state.Velocity.Z} {
		if !finite(value) {
			return false
		}
	}
	return true
}

func (s *Server) identityState(w http.ResponseWriter, r *http.Request, id string) {
	if id == "" {
		s.error(w, http.StatusBadRequest, "invalid_identity_id", "identity id must not be empty")
		return
	}
	epochText := r.URL.Query().Get("epochJd")
	epoch, err := strconv.ParseFloat(epochText, 64)
	if err != nil || !finite(epoch) {
		s.error(w, http.StatusBadRequest, "invalid_epoch", "epochJd must be a finite Julian TDB date")
		return
	}
	frame := r.URL.Query().Get("frame")
	if frame == "" {
		frame = "ECLIPJ2000"
	}
	if frame != "ECLIPJ2000" {
		s.error(w, http.StatusBadRequest, "unsupported_frame", "only ECLIPJ2000 is supported")
		return
	}
	allowApproximate, err := precisionMode(r.URL.Query().Get("precision"))
	if err != nil {
		s.error(w, http.StatusBadRequest, "invalid_precision", err.Error())
		return
	}
	raw, found, err := s.inventory.Get(r.Context(), id)
	if err != nil {
		if r.Context().Err() != nil {
			s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
		} else {
			s.error(w, http.StatusUnprocessableEntity, "inventory_unavailable", err.Error())
		}
		return
	}
	if !found {
		s.error(w, http.StatusNotFound, "identity_not_found", "unknown source identity")
		return
	}
	record, err := inventory.Decode(raw)
	if err != nil {
		s.error(w, http.StatusUnprocessableEntity, "invalid_source_record", err.Error())
		return
	}
	result, err := s.resolveInventoryState(r.Context(), record, epoch, allowApproximate)
	if err != nil {
		s.error(w, http.StatusUnprocessableEntity, "state_unavailable", err.Error())
		return
	}
	response := map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "inventoryManifestSha256": s.inventory.ManifestHash(), "identity": s.inventory.Summary(record), "epochJd": epoch, "timeScale": "TDB", "frame": frame, "distanceUnit": "km", "velocityUnit": "km/s", "precision": map[bool]string{true: "approximate", false: "exact"}[allowApproximate], "availability": result.Availability, "model": result.Model, "missingReason": result.MissingReason, "stateEvidence": result.Evidence, "evidenceWindowEt": result.EvidenceWindow}
	if result.State != nil {
		response["state"] = result.State
	}
	s.json(w, http.StatusOK, response)
}

type trajectoryRequest struct {
	BodyIDs   []string `json:"bodyIds"`
	StartJD   float64  `json:"startJd"`
	EndJD     float64  `json:"endJd"`
	Samples   int      `json:"samples"`
	Frame     string   `json:"frame"`
	Precision string   `json:"precision"`
}
type trajectoryBody struct {
	ID             string               `json:"id"`
	Availability   catalog.Availability `json:"availability"`
	MissingReason  string               `json:"missingReason,omitempty"`
	Model          string               `json:"model,omitempty"`
	Precision      string               `json:"precision,omitempty"`
	SourceRecord   bool                 `json:"sourceRecord,omitempty"`
	IdentityStatus string               `json:"identityStatus,omitempty"`
	ParentID       string               `json:"parentId,omitempty"`
	CenterID       string               `json:"centerId,omitempty"`
	States         []float64            `json:"states,omitempty"`
	StateStride    int                  `json:"stateStride,omitempty"`
}

type sourceStateResult struct {
	Availability   catalog.Availability
	Model          string
	MissingReason  string
	State          *catalog.State
	Evidence       string
	EvidenceWindow map[string]float64
}

func (s *Server) trajectory(w http.ResponseWriter, r *http.Request) {
	var req trajectoryRequest
	dec := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes))
	if err := dec.Decode(&req); err != nil {
		s.error(w, 400, "invalid_json", "request body is not valid JSON")
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		s.error(w, 400, "invalid_json", "request body must contain one JSON object")
		return
	}
	if len(req.BodyIDs) < 1 || len(req.BodyIDs) > 64 {
		s.error(w, 400, "invalid_body_count", "bodyIds must contain 1..64 entries")
		return
	}
	if req.Samples < 2 || req.Samples > 10000 {
		s.error(w, 400, "invalid_samples", "samples must be between 2 and 10000")
		return
	}
	if !finite(req.StartJD) || !finite(req.EndJD) || req.EndJD <= req.StartJD || req.EndJD-req.StartJD > 365250 {
		s.error(w, 400, "invalid_time_range", "time range must be positive and at most 1000 years")
		return
	}
	if req.Frame == "" {
		req.Frame = "ECLIPJ2000"
	}
	if req.Frame != "ECLIPJ2000" {
		s.error(w, 400, "unsupported_frame", "only ECLIPJ2000 is supported")
		return
	}
	allowApproximate, err := precisionMode(req.Precision)
	if err != nil {
		s.error(w, http.StatusBadRequest, "invalid_precision", err.Error())
		return
	}
	step := (req.EndJD - req.StartJD) / float64(req.Samples-1)
	out := make([]trajectoryBody, 0, len(req.BodyIDs))
	seen := map[string]bool{}
	for _, id := range req.BodyIDs {
		if seen[id] {
			s.error(w, 400, "duplicate_body_id", "bodyIds must be unique")
			return
		}
		seen[id] = true
		b, ok := s.catalog.Get(id)
		if !ok && s.inventory != nil {
			raw, found, getErr := s.inventory.Get(r.Context(), id)
			if getErr != nil {
				if r.Context().Err() != nil {
					s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
				} else {
					s.error(w, http.StatusUnprocessableEntity, "inventory_unavailable", getErr.Error())
				}
				return
			}
			if found {
				record, decodeErr := inventory.Decode(raw)
				if decodeErr != nil {
					s.error(w, http.StatusUnprocessableEntity, "invalid_source_record", decodeErr.Error())
					return
				}
				tb := trajectoryBody{ID: id, Availability: catalog.Missing, Precision: map[bool]string{true: "approximate", false: "exact"}[allowApproximate], SourceRecord: true, IdentityStatus: record.IdentityStatus, ParentID: record.ParentID}
				if record.Orbit != nil {
					tb.CenterID = record.Orbit.Center
				}
				var states []float64
				for sample := 0; sample < req.Samples; sample++ {
					if err := r.Context().Err(); err != nil {
						s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
						return
					}
					resolved, stateErr := s.resolveInventoryState(r.Context(), record, req.StartJD+float64(sample)*step, allowApproximate)
					if stateErr != nil {
						s.error(w, http.StatusUnprocessableEntity, "state_unavailable", stateErr.Error())
						return
					}
					if resolved.State == nil {
						tb.Availability = resolved.Availability
						tb.Model = resolved.Model
						tb.MissingReason = resolved.MissingReason
						states = nil
						break
					}
					if states == nil {
						states = make([]float64, 0, req.Samples*6)
					}
					states = appendFlatState(states, *resolved.State)
					tb.Availability = resolved.Availability
					tb.Model = resolved.Model
				}
				tb.States = states
				if len(states) > 0 {
					tb.StateStride = 6
				}
				out = append(out, tb)
				continue
			}
		}
		if !ok {
			s.error(w, 404, "body_not_found", "unknown body id: "+id)
			return
		}
		tb := trajectoryBody{ID: id, Availability: b.Availability, MissingReason: b.MissingReason, Model: b.Model, Precision: map[bool]string{true: "approximate", false: "exact"}[allowApproximate]}
		if b.Availability == catalog.AvailableOperational {
			tb.States = make([]float64, 0, req.Samples*6)
			for i := 0; i < req.Samples; i++ {
				if err := r.Context().Err(); err != nil {
					s.error(w, 408, "cancelled", "request cancelled")
					return
				}
				st, found, err := s.catalog.OperationalState(id, req.StartJD+float64(i)*step)
				if err != nil {
					s.error(w, 422, "state_unavailable", err.Error())
					return
				}
				if !found {
					tb.States = nil
					tb.StateStride = 0
					tb.Availability = catalog.Missing
					tb.MissingReason = s.catalog.KernelMissingReason(id)
					if tb.MissingReason == "" {
						tb.MissingReason = "kernel-coverage-gap"
					}
					break
				}
				tb.States = appendFlatState(tb.States, st)
			}
			if len(tb.States) > 0 {
				tb.StateStride = 6
			}
			out = append(out, tb)
			continue
		}
		if b.Availability == catalog.Missing || b.Elements == nil {
			if tb.MissingReason == "" {
				tb.MissingReason = "no-supported-state-model"
			}
			out = append(out, tb)
			continue
		}
		if !allowApproximate {
			tb.Availability = catalog.Missing
			tb.MissingReason = "approximate-model-requires-explicit-opt-in"
			out = append(out, tb)
			continue
		}
		tb.Model = b.Model
		tb.States = make([]float64, 0, req.Samples*6)
		for i := 0; i < req.Samples; i++ {
			if err := r.Context().Err(); err != nil {
				s.error(w, 408, "cancelled", "request cancelled")
				return
			}
			st, err := science.PropagateBoundElliptic(r.Context(), science.Elements{SemiMajorAxisAU: b.Elements.SemiMajorAxisAU, Eccentricity: b.Elements.Eccentricity, InclinationDeg: b.Elements.InclinationDeg, AscendingNodeDeg: b.Elements.AscendingNodeDeg, ArgPeriapsisDeg: b.Elements.ArgPeriapsisDeg, MeanAnomalyDeg: b.Elements.MeanAnomalyDeg, MeanMotionDegPerDay: b.Elements.MeanMotionDegPerDay}, b.EpochJD, req.StartJD+float64(i)*step)
			if err != nil {
				s.error(w, 422, "state_unavailable", err.Error())
				return
			}
			tb.States = appendFlatState(tb.States, catalog.State{Position: catalog.Vec3{X: st.Position.X, Y: st.Position.Y, Z: st.Position.Z}, Velocity: catalog.Vec3{X: st.Velocity.X, Y: st.Velocity.Y, Z: st.Velocity.Z}})
		}
		if len(tb.States) > 0 {
			tb.StateStride = 6
		}
		out = append(out, tb)
	}
	s.json(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "frame": req.Frame, "timeScale": "TDB", "startJd": req.StartJD, "endJd": req.EndJD, "distanceUnit": "km", "velocityUnit": "km/s", "precision": map[bool]string{true: "approximate", false: "exact"}[allowApproximate], "stateLayout": "row-major-[x,y,z,vx,vy,vz]", "modelBoundary": "Exact requests use only verified SPK coefficients or source state evidence; approximate source-element propagation is explicit opt-in.", "bodies": out})
}

func appendFlatState(dst []float64, state catalog.State) []float64 {
	return append(dst, state.Position.X, state.Position.Y, state.Position.Z, state.Velocity.X, state.Velocity.Y, state.Velocity.Z)
}

func (s *Server) preview(w http.ResponseWriter, _ *http.Request) {
	body := map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "manifestSha256": s.catalog.ManifestHash(), "profile": "pages-preview", "generatedAt": "", "entries": []map[string]any{{"id": "sun", "availability": "available"}, {"id": "earth", "availability": "available"}, {"id": "moon", "availability": "available"}, {"id": "mars", "availability": "available"}, {"id": "jupiter", "availability": "available"}, {"id": "saturn", "availability": "available"}, {"id": "uranus", "availability": "full-only", "label": "Full version / 完整版", "reason": "Not available in this preview; use the full version / 预览版暂不开放，请使用完整版"}}}
	raw, _ := json.Marshal(body)
	sum := sha256.Sum256(raw)
	w.Header().Set("ETag", `"`+hex.EncodeToString(sum[:])+`"`)
	s.json(w, 200, body)
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func parseIntDefault(v string, d int) (int, error) {
	if v == "" {
		return d, nil
	}
	return strconv.Atoi(v)
}
func (s *Server) error(w http.ResponseWriter, status int, code, msg string) {
	s.json(w, status, map[string]any{"apiVersion": catalog.APIVersion, "error": map[string]string{"code": code, "message": msg}})
}
func (s *Server) json(w http.ResponseWriter, status int, v any) {
	raw, err := json.Marshal(v)
	if err != nil {
		s.error(w, http.StatusInternalServerError, "encode_response", "response could not be encoded")
		return
	}
	raw = append(raw, '\n')
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

func (s *Server) jsonLimited(w http.ResponseWriter, status int, v any, limit int) {
	raw, err := json.Marshal(v)
	if err != nil {
		s.error(w, http.StatusInternalServerError, "encode_response", "response could not be encoded")
		return
	}
	if len(raw) > limit {
		s.error(w, http.StatusRequestEntityTooLarge, "response_too_large", "response exceeds the configured byte limit")
		return
	}
	raw = append(raw, '\n')
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}
