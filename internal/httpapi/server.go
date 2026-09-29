package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math"
	"net/http"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"

	"github.com/dajiaohuang/solar/backend/internal/bodyshape"
	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/coverage"
	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
	"github.com/dajiaohuang/solar/backend/internal/orbituncertainty"
	"github.com/dajiaohuang/solar/backend/internal/stellarmotion"
)

const maxBodyBytes = 1 << 20

type Server struct {
	orbitSource         *orbituncertainty.DE440Source
	catalog             *catalog.Catalog
	inventory           *inventory.Inventory
	scheduler           *requestScheduler
	windowStreams       *requestScheduler
	stellarBatches      *requestScheduler
	compute             *requestScheduler
	tileSlots           chan struct{}
	plans               *statePlanCache
	tiles               *stateTileCache
	stellarManifests    *stellarmotion.GaiaMotionManifestCache
	stateTileByteBudget int64
	coverage            *coverage.Ledger
	earthOrientation    *earthorientation.Table
	bodyRadii           *bodyshape.Table
	inFlight            atomic.Int64
	cancelled           atomic.Uint64
}

func New(c *catalog.Catalog, maxConcurrent int, inventories ...*inventory.Inventory) *Server {
	var inv *inventory.Inventory
	if len(inventories) > 0 {
		inv = inventories[0]
	}
	return newServer(c, maxConcurrent, inv, nil)
}

// NewWithCoverage installs an already validated, immutable coverage ledger.
// A nil ledger deliberately leaves the optional coverage endpoints unavailable.
func NewWithCoverage(c *catalog.Catalog, maxConcurrent int, inv *inventory.Inventory, ledger *coverage.Ledger) *Server {
	return newServer(c, maxConcurrent, inv, ledger)
}

func newServer(c *catalog.Catalog, maxConcurrent int, inv *inventory.Inventory, ledger *coverage.Ledger) *Server {
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	windowStreamLimit := min(maxConcurrent, maxConcurrentStateWindowStreams)
	return &Server{catalog: c, inventory: inv, coverage: ledger, scheduler: newRequestScheduler(maxConcurrent, requestQueueCapacity, requestQueueTimeout), windowStreams: newRequestScheduler(windowStreamLimit, requestQueueCapacity, requestQueueTimeout), stellarBatches: newRequestScheduler(min(maxConcurrent, 2), 4, requestQueueTimeout), compute: newRequestScheduler(runtime.GOMAXPROCS(0), requestQueueCapacity, requestQueueTimeout), tileSlots: make(chan struct{}, 2), plans: newStatePlanCache(statePlanCacheItems), tiles: newStateTileCache(stateTileCacheBytes), stellarManifests: stellarmotion.NewGaiaMotionManifestCache(), stateTileByteBudget: maxStateTileBytes}
}

// ConfigureComputeWorkers sets the CPU block budget before serving requests.
// Zero follows GOMAXPROCS; request admission remains independent.
func (s *Server) ConfigureComputeWorkers(workers int) {
	if workers <= 0 {
		workers = runtime.GOMAXPROCS(0)
	}
	s.compute = newRequestScheduler(workers, requestQueueCapacity, requestQueueTimeout)
}

func (s *Server) ComputeStats() map[string]uint64 { return s.compute.stats() }

// SchedulerStats is local benchmark evidence, not a public metrics endpoint.
func (s *Server) SchedulerStats() map[string]uint64 { return s.scheduler.stats() }

// StateWindowStats isolates long-lived stream admission from ordinary requests.
func (s *Server) StateWindowStats() map[string]uint64 { return s.windowStreams.stats() }

// TileCacheStats exposes bounded runtime evidence to the local benchmark
// harness without adding diagnostic state to the wire protocol.
func (s *Server) TileCacheStats() map[string]uint64 {
	if s.tiles == nil {
		return map[string]uint64{}
	}
	stats := s.tiles.stats()
	stats["encoderSlotsActive"] = uint64(len(s.tileSlots))
	stats["encoderSlotsLimit"] = uint64(cap(s.tileSlots))
	return stats
}

// PlanCacheStats describes retained preflight work for local memory probes.
func (s *Server) PlanCacheStats() map[string]uint64 {
	items, bytes, maxBytes, hits, builds, coalesced, active := s.plans.stats()
	return map[string]uint64{"items": uint64(items), "residentBytes": uint64(bytes), "maxResidentBytes": uint64(maxBytes),
		"cacheHits": hits, "builds": builds, "coalescedRequests": coalesced, "activeBuilds": uint64(active)}
}

// StellarManifestCacheStats exposes process-local manifest reuse evidence to
// focused benchmarks without adding diagnostics to the public API.
func (s *Server) StellarManifestCacheStats() map[string]uint64 {
	return s.stellarManifests.Stats()
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
	// These immutable metadata/liveness routes must remain responsive while
	// expensive work is admitted. Directory and identity-detail GETs still use
	// bounded admission: a GET method alone is not evidence of cheap work.
	if r.Method == http.MethodGet {
		switch r.URL.Path {
		case "/v1/health/live", "/v1/health/ready":
			s.json(w, http.StatusOK, map[string]any{"status": "ok", "catalogManifestSha256": s.catalog.ManifestHash()})
			return
		case "/v1/catalog/manifest":
			s.catalogManifest(w, r)
			return
		case "/v1/observation/metadata":
			s.json(w, http.StatusOK, s.observationMetadata())
			return
		}
	}
	r = r.WithContext(context.WithValue(r.Context(), computeClassKey{}, classifyRequest(r)))
	// Admission precedes JSON decoding and scientific work. Waiting is bounded
	// separately per class, so directory scans cannot consume every queue slot.
	if err := r.Context().Err(); err != nil {
		s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
		return
	}
	requestAdmission := s.scheduler
	if r.Method == http.MethodPost && r.URL.Path == "/v1/state/window" {
		// Long-lived streaming responses have a separate bounded lane. Holding
		// a general request slot until a slow client finishes would let history
		// streams starve interactive API requests after CPU admission is released.
		requestAdmission = s.windowStreams
	} else if r.Method == http.MethodPost && r.URL.Path == "/v1/stellar/motion/tile" {
		// A batch carries a decoded Gaia chunk and retains it through propagation.
		// Isolate its body and compute admission from interactive request capacity.
		requestAdmission = s.stellarBatches
	}
	release, err := requestAdmission.acquire(r.Context(), classifyRequest(r))
	if err != nil {
		if r.Context().Err() != nil {
			s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
			return
		}
		w.Header().Set("Retry-After", "1")
		s.error(w, http.StatusTooManyRequests, "overloaded", "scientific queue is full or its wait expired; retry later")
		return
	}
	defer release()
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
	case r.Method == "POST" && path == "observation":
		s.observation(w, r)
	case r.Method == "POST" && path == "observation/windows":
		s.observationWindows(w, r)
	case r.Method == "POST" && path == "observation/contacts":
		s.observationContacts(w, r)
	case r.Method == "POST" && path == "stellar/motion":
		s.stellarMotion(w, r)
	case r.Method == "POST" && path == "stellar/motion/tile":
		s.stellarMotionTile(w, r)
	case r.Method == "POST" && path == "stellar/observer":
		s.stellarObserver(w, r)
	case r.Method == "POST" && path == "orbit/covariance/inspect":
		s.orbitCovarianceInspect(w, r)
	case r.Method == "POST" && path == "orbit/covariance/convert":
		s.orbitCovarianceConvert(w, r)
	case r.Method == "POST" && path == "orbit/covariance/propagate":
		s.orbitCovariancePropagate(w, r)
	case r.Method == "POST" && path == "orbit/covariance/ensemble":
		s.orbitEnsemblePropagate(w, r)
	case r.Method == "POST" && path == "orbit/covariance/ensemble/events":
		s.orbitEnsembleEvents(w, r)
	case r.Method == "GET" && path == "catalog/manifest":
		s.catalogManifest(w, r)
	case r.Method == "GET" && path == "coverage":
		s.coverageSummary(w, r)
	case r.Method == "GET" && path == "coverage/targets":
		s.coverageTargets(w, r)
	case r.Method == "POST" && path == "state/window":
		s.stateWindow(w, r)
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
	s.json(w, http.StatusOK, map[string]any{
		"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "manifestSha256": s.catalog.ManifestHash(), "coverage": coverage,
		"contract": map[string]any{
			"timeScale": "TDB", "epoch": "Julian date", "frame": "ECLIPJ2000", "distanceUnit": "km", "velocityUnit": "km/s",
			"precisionModes": []string{"exact"},
			"stateTiles":     map[string]any{"precision": "exact-only", "stateOriginId": "naif:0", "fieldMask": []string{"position", "velocity"}},
			"modelBoundary":  "State plans, tiles, and historical state windows return exact-provenance or missing states; server-side approximate fallback is disabled",
			"nBody":          false, "auditIdentities": identities,
		},
		"limits": map[string]int{
			"catalogPageMax": 500, "statePlanIDsMax": maxStatePlanIDs, "statePlanBytesMax": maxStatePlanBytes, "stateTileBodiesMax": maxStateTileBodies, "stateTileBytesMax": maxStateTileBytes,
			"gaiaMotionBatchRowsMax": gaiaMotionBatchRowsMax,
			"statePlanCacheItemsMax": statePlanCacheItems, "statePlanCacheBytesMax": statePlanCacheBytes,
			"stateWindowIDsMax": maxWindowIDs, "stateWindowEpochsMax": maxWindowEpochs, "stateWindowStatesMax": maxWindowStates,
			"inventoryPageMax": 500, "inventoryMaxIndexedRecords": inventory.MaxIndexedRecords, "inventoryMaxIndexPostings": inventory.MaxIndexPostings,
			"inventoryMaxShards": inventory.MaxShards, "inventoryMaxShardBytes": inventory.MaxShardBytes,
			"inventoryBlockRowsMax": inventory.MaxBlockRows, "inventoryBlockBytesMax": inventory.MaxBlockBytes, "inventoryBlockCacheBytesMax": inventory.BlockCacheBytes,
		},
		"profiles": map[string]any{
			"full":    map[string]any{"catalog": true, "identities": s.inventory != nil, "trajectory": true, "stateTiles": true, "stateWindows": true},
			"preview": map[string]any{"catalog": "curated", "fullOnlyVisible": true, "restrictedActions": "blocked"},
		},
	})
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
	if strings.Contains(id, "/") {
		s.error(w, http.StatusNotFound, "not_found", "unknown endpoint")
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

func (s *Server) resolveInventoryStateWithOperational(ctx context.Context, record inventory.Record, jd float64, operational map[string]catalog.State, operationalFound map[string]bool, evidence map[string]catalog.OperationalProvenance) (sourceStateResult, error) {
	// State tiles admit exact provenance only; approximate source elements
	// remain visible as missing inventory rows.
	if !finite(jd) {
		return sourceStateResult{Availability: catalog.Missing, MissingReason: "invalid-epoch"}, nil
	}
	snapshotReason := ""
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
				var states map[string]catalog.State
				var available map[string]bool
				states, available, evidence, err = s.catalog.EvalBatchContext(ctx, []string{catalogID}, jd)
				state, found = states[catalogID], available[catalogID]
			}
			if err != nil {
				return sourceStateResult{}, err
			}
			if found && finiteState(state) {
				provenance, provenanceOK := evidence[catalogID]
				datasetOK := s.hasInventoryDatasetProvenance()
				if provenanceOK && provenance.Source != "" && validProvenanceSHA256(provenance.KernelSHA256) && validProvenanceSHA256(provenance.SourceChainSHA256) && datasetOK {
					var window map[string]float64
					if provenance.ValidityPresent {
						window = map[string]float64{"startEt": provenance.ValidityStartET, "endEt": provenance.ValidityEndET}
					}
					result := sourceStateResult{
						Availability:   catalog.AvailableOperational,
						Model:          "spk-original",
						State:          &state,
						Evidence:       "catalog-kernel",
						EvidenceWindow: window,
					}
					return result, nil
				}
				snapshotReason = "kernel-provenance-unavailable"
			}
		}
	}
	if record.KernelEvidence != nil && record.KernelEvidence.StateAtAuditEpoch != nil && epochMatchesEvidence(record, jd) {
		if strings.TrimSpace(record.IdentityStatus) == "" {
			snapshotReason = "source-identity-status-unavailable"
		} else if segment, ok := matchingEvidenceSegment(record); !ok {
			snapshotReason = "kernel-provenance-unavailable"
		} else if kernelHash, ok := s.catalog.KernelSHA256(segment.KernelID); !ok || !validProvenanceSHA256(kernelHash) || kernelHash != record.KernelEvidence.SourceKernelSHA256 || !validProvenanceSHA256(record.KernelEvidence.SourceChainSHA256) {
			snapshotReason = "kernel-provenance-unavailable"
		} else {
			if !s.hasInventoryDatasetProvenance() {
				snapshotReason = "kernel-provenance-unavailable"
			} else {
				v := record.KernelEvidence.StateAtAuditEpoch
				state := catalog.State{Position: catalog.Vec3{X: v.Position.X, Y: v.Position.Y, Z: v.Position.Z}, Velocity: catalog.Vec3{X: v.Velocity.X, Y: v.Velocity.Y, Z: v.Velocity.Z}}
				if finiteState(state) {
					result := sourceStateResult{Availability: catalog.AvailableSnapshot, Model: "source-kernel-state-at-audit-epoch", State: &state, Evidence: "inventory-kernel-evidence", EvidenceWindow: matchingEvidenceWindow(record)}
					return result, nil
				}
				snapshotReason = "unvalidated-source-kernel-evidence"
			}
		}
	}
	if snapshotReason != "" {
		return sourceStateResult{Availability: catalog.Missing, Model: "exact-only", MissingReason: snapshotReason}, nil
	}
	return sourceStateResult{Availability: catalog.Missing, Model: "exact-only", MissingReason: missingInventoryStateReason(record)}, nil
}

func (s *Server) hasInventoryDatasetProvenance() bool {
	if s.inventory == nil {
		return false
	}
	return validProvenanceSHA256(s.inventory.ManifestHash())
}

func validProvenanceSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

type sourceStateResult struct {
	Availability   catalog.Availability
	Model          string
	MissingReason  string
	State          *catalog.State
	Evidence       string
	EvidenceWindow map[string]float64
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
	_, ok := matchingEvidenceSegment(record)
	return ok
}

func matchingEvidenceWindow(record inventory.Record) map[string]float64 {
	segment, ok := matchingEvidenceSegment(record)
	if !ok || record.KernelEvidence == nil {
		return nil
	}
	return map[string]float64{"startEt": segment.StartET, "endEt": segment.EndET}
}

func finiteState(state catalog.State) bool {
	for _, value := range []float64{state.Position.X, state.Position.Y, state.Position.Z, state.Velocity.X, state.Velocity.Y, state.Velocity.Z} {
		if !finite(value) {
			return false
		}
	}
	return true
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
	// Reserve the trailing newline in the advertised response-byte budget.
	if len(raw) >= limit {
		s.error(w, http.StatusRequestEntityTooLarge, "response_too_large", "response exceeds the configured byte limit")
		return
	}
	raw = append(raw, '\n')
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}
