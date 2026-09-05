package httpapi

import (
	"container/list"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
	"github.com/dajiaohuang/solar/backend/internal/statewire"
)

const (
	maxStatePlanIDs      = 32768
	maxStateTileBodies   = 32768
	defaultStateTileSize = 16384
	maxStateTileBytes    = 64 << 20
	maxStatePlanBytes    = 8 << 20
	statePlanTTL         = 2 * time.Minute
	statePlanEstimateRow = 1024
	statePlanCacheBytes  = 128 << 20
	statePlanCacheItems  = 64
	stateTileCacheBytes  = 64 << 20
)

type statePlanRequest struct {
	IDs       []string `json:"ids"`
	EpochJD   float64  `json:"epochJd"`
	TimeScale string   `json:"timeScale"`
	Frame     string   `json:"frame"`
	Precision string   `json:"precision"`
	FieldMask []string `json:"fieldMask"`
	TileSize  int      `json:"tileSize"`
}

type statePlanTile struct {
	Sequence       uint32 `json:"sequence"`
	OrdinalStart   uint32 `json:"ordinalStart"`
	OrdinalCount   uint32 `json:"ordinalCount"`
	EstimatedBytes int64  `json:"estimatedBytes"`
}

type statePlanResponse struct {
	APIVersion              string          `json:"apiVersion"`
	CatalogVersion          string          `json:"catalogVersion"`
	CatalogManifestSHA256   string          `json:"catalogManifestSha256"`
	InventoryManifestSHA256 string          `json:"inventoryManifestSha256,omitempty"`
	RequestIDsSHA256        string          `json:"requestIdsSha256"`
	PlanID                  string          `json:"planId"`
	EpochJD                 float64         `json:"epochJd"`
	TimeScale               string          `json:"timeScale"`
	Frame                   string          `json:"frame"`
	Precision               string          `json:"precision"`
	StateOriginID           string          `json:"stateOriginId"`
	DistanceUnit            string          `json:"distanceUnit"`
	VelocityUnit            string          `json:"velocityUnit"`
	FieldMask               []string        `json:"fieldMask"`
	BodyCount               int             `json:"bodyCount"`
	Stride                  int             `json:"stride"`
	TileSize                int             `json:"tileSize"`
	TileCount               int             `json:"tileCount"`
	ExactCount              int             `json:"exactCount"`
	ApproximateCount        int             `json:"approximateCount"`
	MissingCount            int             `json:"missingCount"`
	EstimatedBytes          int64           `json:"estimatedBytes"`
	Tiles                   []statePlanTile `json:"tiles"`
}

type stateTileRequest struct {
	PlanID   string `json:"planId"`
	Sequence uint32 `json:"sequence"`
}

type statePlanRow struct {
	metadata    statewire.Metadata
	catalogBody *catalog.Body
	record      *inventory.Record
	state       *catalog.State
	exact       bool
}

type statePlan struct {
	response statePlanResponse
	rows     []statePlanRow
	hash     [32]byte
	created  time.Time
}

type statePlanCacheEntry struct {
	key   string
	plan  *statePlan
	used  time.Time
	bytes int64
}

type statePlanCache struct {
	mu       sync.Mutex
	max      int
	maxBytes int64
	bytes    int64
	ttl      time.Duration
	items    map[string]*list.Element
	order    *list.List
}

type stateTileCacheValue struct {
	raw  []byte
	etag string
}

type stateTileCacheEntry struct {
	key   string
	value stateTileCacheValue
	used  time.Time
	bytes int64
}

type stateTileCache struct {
	mu       sync.Mutex
	maxBytes int64
	bytes    int64
	hits     uint64
	misses   uint64
	items    map[string]*list.Element
	order    *list.List
}

func newStateTileCache(maxBytes int64) *stateTileCache {
	if maxBytes < 1 {
		maxBytes = 1
	}
	return &stateTileCache{maxBytes: maxBytes, items: make(map[string]*list.Element), order: list.New()}
}

func (c *stateTileCache) get(key string) (stateTileCacheValue, bool) {
	return c.lookup(key, true)
}

func (c *stateTileCache) peek(key string) (stateTileCacheValue, bool) {
	return c.lookup(key, false)
}

func (c *stateTileCache) lookup(key string, count bool) (stateTileCacheValue, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e := c.items[key]
	if e == nil {
		if count {
			c.misses++
		}
		return stateTileCacheValue{}, false
	}
	entry := e.Value.(*stateTileCacheEntry)
	if time.Since(entry.used) > statePlanTTL {
		delete(c.items, key)
		c.bytes -= entry.bytes
		c.order.Remove(e)
		if count {
			c.misses++
		}
		return stateTileCacheValue{}, false
	}
	entry.used = time.Now()
	c.order.MoveToFront(e)
	if count {
		c.hits++
	}
	return entry.value, true
}

func (c *stateTileCache) put(key string, value stateTileCacheValue) {
	weight := int64(len(value.raw) + len(value.etag))
	if weight > c.maxBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if e := c.items[key]; e != nil {
		entry := e.Value.(*stateTileCacheEntry)
		c.bytes -= entry.bytes
		entry.value, entry.used, entry.bytes = value, time.Now(), weight
		c.bytes += weight
		c.order.MoveToFront(e)
	} else {
		e := c.order.PushFront(&stateTileCacheEntry{key: key, value: value, used: time.Now(), bytes: weight})
		c.items[key] = e
		c.bytes += weight
	}
	for c.bytes > c.maxBytes {
		e := c.order.Back()
		entry := e.Value.(*stateTileCacheEntry)
		delete(c.items, entry.key)
		c.bytes -= entry.bytes
		c.order.Remove(e)
	}
}

func (c *stateTileCache) stats() map[string]uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return map[string]uint64{"items": uint64(len(c.items)), "residentBytes": uint64(c.bytes), "maxResidentBytes": uint64(c.maxBytes), "hits": c.hits, "misses": c.misses}
}

func newStatePlanCache(max int, maxBytes ...int64) *statePlanCache {
	if max < 1 {
		max = 1
	}
	byteLimit := int64(statePlanCacheBytes)
	if len(maxBytes) > 0 {
		byteLimit = maxBytes[0]
	}
	if byteLimit < 1 {
		byteLimit = 1
	}
	return &statePlanCache{max: max, maxBytes: byteLimit, ttl: statePlanTTL, items: make(map[string]*list.Element), order: list.New()}
}

func (c *statePlanCache) get(key string) (*statePlan, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e := c.items[key]
	if e == nil {
		return nil, false
	}
	entry := e.Value.(*statePlanCacheEntry)
	if time.Since(entry.used) > c.ttl {
		delete(c.items, key)
		c.bytes -= entry.bytes
		c.order.Remove(e)
		return nil, false
	}
	entry.used = time.Now()
	c.order.MoveToFront(e)
	return entry.plan, true
}

func (c *statePlanCache) put(key string, plan *statePlan) {
	weight := statePlanResidentBytes(plan)
	if weight > c.maxBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if e := c.items[key]; e != nil {
		entry := e.Value.(*statePlanCacheEntry)
		c.bytes -= entry.bytes
		entry.plan, entry.used, entry.bytes = plan, time.Now(), weight
		c.bytes += weight
		c.order.MoveToFront(e)
	} else {
		e := c.order.PushFront(&statePlanCacheEntry{key: key, plan: plan, used: time.Now(), bytes: weight})
		c.items[key] = e
		c.bytes += weight
	}
	for c.order.Len() > c.max || c.bytes > c.maxBytes {
		old := c.order.Back()
		entry := old.Value.(*statePlanCacheEntry)
		delete(c.items, entry.key)
		c.bytes -= entry.bytes
		c.order.Remove(old)
	}
}

func statePlanResidentBytes(plan *statePlan) int64 {
	if plan == nil {
		return 0
	}
	bytes := int64(1024 + len(plan.response.Tiles)*40)
	for _, row := range plan.rows {
		metadata := row.metadata
		bytes += 256 + int64(len(metadata.ID)+len(metadata.Source)+len(metadata.DatasetVersion)+len(metadata.DatasetSHA256)+len(metadata.KernelSHA256)+len(metadata.Model)+len(metadata.CenterID)+len(metadata.StateEvidence)+len(metadata.MissingReason)+len(metadata.IdentityStatus))
		if row.state != nil {
			bytes += statewire.Stride * 8
		}
	}
	return bytes
}

func (c *statePlanCache) stats() (items int, bytes, maxBytes int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items), c.bytes, c.maxBytes
}

func (s *Server) catalogManifest(w http.ResponseWriter, _ *http.Request) {
	stats := s.catalog.Stats()
	body := map[string]any{
		"apiVersion":            catalog.APIVersion,
		"catalogVersion":        s.catalog.Version(),
		"catalogManifestSha256": s.catalog.ManifestHash(),
		"profile":               s.catalog.ManifestProfile(),
		"contract":              s.catalog.ManifestContract(),
		"counts":                stats,
		"limits":                map[string]int{"maxIds": maxStatePlanIDs, "tileSizeMin": 1, "tileSizeMax": maxStateTileBodies, "defaultTileSize": defaultStateTileSize, "maxTileBytes": maxStateTileBytes, "planCacheItems": statePlanCacheItems, "planCacheBytes": statePlanCacheBytes},
	}
	if s.inventory != nil {
		body["inventoryManifestSha256"] = s.inventory.ManifestHash()
	}
	s.json(w, http.StatusOK, body)
}

func (s *Server) statePlan(w http.ResponseWriter, r *http.Request) {
	var req statePlanRequest
	if err := decodeOneJSON(r, &req); err != nil {
		s.error(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	ids, err := normalizePlanRequest(&req)
	if err != nil {
		s.error(w, http.StatusBadRequest, "invalid_plan", err.Error())
		return
	}
	canonical := struct {
		IDs       []string `json:"ids"`
		EpochJD   float64  `json:"epochJd"`
		TimeScale string   `json:"timeScale"`
		Frame     string   `json:"frame"`
		Precision string   `json:"precision"`
		FieldMask []string `json:"fieldMask"`
		TileSize  int      `json:"tileSize"`
		Catalog   string   `json:"catalogManifestSha256"`
		Inventory string   `json:"inventoryManifestSha256"`
	}{ids, req.EpochJD, req.TimeScale, req.Frame, req.Precision, req.FieldMask, req.TileSize, s.catalog.ManifestHash(), ""}
	if s.inventory != nil {
		canonical.Inventory = s.inventory.ManifestHash()
	}
	canonicalBytes, _ := json.Marshal(canonical)
	planHash := sha256.Sum256(canonicalBytes)
	planID := fmt.Sprintf("%x", planHash[:])
	if plan, ok := s.plans.get(planID); ok {
		s.json(w, http.StatusOK, plan.response)
		return
	}
	// This estimate is deliberately conservative and is checked before any
	// inventory read or SPK/Kepler calculation occurs.
	maxTileBytes := s.stateTileByteBudget
	if maxTileBytes <= 0 {
		maxTileBytes = maxStateTileBytes
	}
	tiles, estimated, err := estimateStateTileBudget(len(ids), req.TileSize, maxStatePlanBytes, maxTileBytes)
	if err != nil {
		s.error(w, http.StatusRequestEntityTooLarge, "plan_too_large", "estimated state tile response exceeds the configured budget")
		return
	}
	tileCount := len(tiles)
	rows, exact, missing, err := s.preparePlanRows(r.Context(), ids, req.EpochJD, planHash)
	if err != nil {
		if r.Context().Err() != nil {
			s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
		} else {
			s.error(w, http.StatusUnprocessableEntity, "state_unavailable", err.Error())
		}
		return
	}
	response := statePlanResponse{APIVersion: catalog.APIVersion, CatalogVersion: s.catalog.Version(), CatalogManifestSHA256: s.catalog.ManifestHash(), PlanID: planID, EpochJD: req.EpochJD, TimeScale: req.TimeScale, Frame: req.Frame, Precision: req.Precision, StateOriginID: "naif:0", DistanceUnit: "km", VelocityUnit: "km/s", FieldMask: append([]string(nil), req.FieldMask...), BodyCount: len(ids), Stride: statewire.Stride, TileSize: req.TileSize, TileCount: tileCount, ExactCount: exact, ApproximateCount: 0, MissingCount: missing, EstimatedBytes: estimated, Tiles: tiles}
	response.RequestIDsSHA256 = requestIDsHash(ids)
	if s.inventory != nil {
		response.InventoryManifestSHA256 = s.inventory.ManifestHash()
	}
	plan := &statePlan{response: response, rows: rows, hash: planHash, created: time.Now()}
	s.plans.put(planID, plan)
	s.jsonLimited(w, http.StatusOK, response, maxStatePlanBytes)
}

func requestIDsHash(ids []string) string {
	h := sha256.New()
	var length [4]byte
	for _, id := range ids {
		binary.LittleEndian.PutUint32(length[:], uint32(len([]byte(id))))
		_, _ = h.Write(length[:])
		_, _ = h.Write([]byte(id))
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

func normalizePlanRequest(req *statePlanRequest) ([]string, error) {
	if len(req.IDs) < 1 || len(req.IDs) > maxStatePlanIDs {
		return nil, fmt.Errorf("ids must contain 1..%d entries", maxStatePlanIDs)
	}
	seen := make(map[string]struct{}, len(req.IDs))
	ids := make([]string, len(req.IDs))
	for n, id := range req.IDs {
		id = strings.TrimSpace(id)
		if id == "" {
			return nil, fmt.Errorf("ids must not contain empty entries")
		}
		if _, ok := seen[id]; ok {
			return nil, fmt.Errorf("ids must be unique")
		}
		seen[id] = struct{}{}
		ids[n] = id
	}
	if !finite(req.EpochJD) {
		return nil, fmt.Errorf("epochJd must be finite")
	}
	if req.TimeScale == "" {
		req.TimeScale = "TDB"
	}
	if req.TimeScale != "TDB" || req.Frame != "" && req.Frame != "ECLIPJ2000" || req.Precision != "" && req.Precision != "exact" {
		return nil, fmt.Errorf("only TDB, ECLIPJ2000 and exact are supported")
	}
	if req.Frame == "" {
		req.Frame = "ECLIPJ2000"
	}
	if req.Precision == "" {
		req.Precision = "exact"
	}
	if req.TileSize == 0 {
		req.TileSize = defaultStateTileSize
	}
	if req.TileSize < 1 || req.TileSize > maxStateTileBodies {
		return nil, fmt.Errorf("tileSize must be between 1 and %d", maxStateTileBodies)
	}
	if len(req.FieldMask) != 2 || req.FieldMask[0] != "position" || req.FieldMask[1] != "velocity" {
		return nil, fmt.Errorf("fieldMask must be [position, velocity]")
	}
	return ids, nil
}

func (s *Server) preparePlanRows(ctx context.Context, ids []string, epoch float64, _ [32]byte) ([]statePlanRow, int, int, error) {
	rows := make([]statePlanRow, len(ids))
	unknown := make([]string, 0)
	for n, id := range ids {
		if body, ok := s.catalog.Get(id); ok {
			bodyCopy := body
			row := statePlanRow{catalogBody: &bodyCopy, metadata: statewire.Metadata{ID: id, Source: body.Source, DatasetVersion: body.DatasetVersion, DatasetSHA256: s.catalog.ManifestHash(), KernelSHA256: body.KernelSHA256, Model: exactModel(body), CenterID: body.ParentID, SourceRecord: false}}
			if finite(body.ValidityStartET) && finite(body.ValidityEndET) && body.ValidityEndET >= body.ValidityStartET {
				row.metadata.ValidityStartET, row.metadata.ValidityEndET, row.metadata.ValidityPresent = body.ValidityStartET, body.ValidityEndET, true
			}
			rows[n] = row
			continue
		}
		unknown = append(unknown, id)
	}
	if len(unknown) > 0 && s.inventory != nil {
		rawRows, err := s.inventory.GetMany(ctx, unknown)
		if err != nil {
			return nil, 0, 0, err
		}
		for n, id := range ids {
			if rows[n].metadata.ID != "" {
				continue
			}
			raw, ok := rawRows[id]
			if !ok {
				rows[n] = statePlanRow{metadata: statewire.Metadata{ID: id, Model: "exact-only", MissingReason: "unknown-identity", SourceRecord: false}}
				continue
			}
			record, err := inventory.Decode(raw)
			if err != nil {
				return nil, 0, 0, err
			}
			recordCopy := record
			center := record.ParentID
			if record.Orbit != nil {
				center = record.Orbit.Center
			}
			rows[n] = statePlanRow{record: &recordCopy, metadata: statewire.Metadata{ID: id, Source: record.Source, DatasetVersion: "inventory:" + s.inventory.ManifestHash(), DatasetSHA256: s.inventory.ManifestHash(), Model: "exact-only", CenterID: center, IdentityStatus: record.IdentityStatus, SourceRecord: true}}
		}
	} else {
		for n, row := range rows {
			if row.metadata.ID == "" {
				rows[n] = statePlanRow{metadata: statewire.Metadata{ID: ids[n], Model: "exact-only", MissingReason: "unknown-identity"}}
			}
		}
	}
	resolved, exact, missing, err := s.resolvePlanRows(ctx, rows, epoch)
	if err != nil {
		return nil, 0, 0, err
	}
	// Cached plans only need frozen wire metadata and final values. Release the
	// much larger catalog/inventory source objects before admitting the plan to
	// the resident-byte-bounded cache.
	for n := range resolved {
		resolved[n].catalogBody = nil
		resolved[n].record = nil
	}
	return resolved, exact, missing, nil
}

// resolvePlanRows performs the one numerical preflight for a plan.  The
// resulting metadata, status, and state are retained in the bounded plan
// cache, so serving a tile is only slicing and encoding work.
func (s *Server) resolvePlanRows(ctx context.Context, rows []statePlanRow, epoch float64) ([]statePlanRow, int, int, error) {
	operationalIDs := make([]string, 0, len(rows))
	seen := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		id := ""
		if row.catalogBody != nil && row.catalogBody.Availability == catalog.AvailableOperational {
			id = row.catalogBody.ID
		} else if row.record != nil && row.record.NAIFID != 0 {
			id = "naif:" + strconv.Itoa(row.record.NAIFID)
		}
		if id != "" {
			if _, ok := seen[id]; !ok {
				seen[id] = struct{}{}
				operationalIDs = append(operationalIDs, id)
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, 0, 0, err
	}
	operational, found, err := s.catalogOperationalStates(ctx, operationalIDs, epoch)
	if err != nil {
		return nil, 0, 0, err
	}
	exact, missing := 0, 0
	for n := range rows {
		if err := ctx.Err(); err != nil {
			return nil, 0, 0, err
		}
		row := &rows[n]
		if row.catalogBody != nil {
			if row.catalogBody.Availability == catalog.AvailableOperational {
				state, ok := operational[row.catalogBody.ID]
				if found[row.catalogBody.ID] && ok && finiteState(state) {
					provenance, provenanceOK, provenanceErr := s.catalog.OperationalProvenance(row.catalogBody.ID, epoch)
					if provenanceErr != nil {
						return nil, 0, 0, provenanceErr
					}
					if !provenanceOK {
						row.metadata.MissingReason = "kernel-provenance-unavailable"
						missing++
						continue
					}
					row.metadata.Source = provenance.Source
					row.metadata.KernelSHA256 = provenance.KernelSHA256
					row.metadata.CenterID = provenance.CenterID
					row.metadata.ValidityStartET = provenance.ValidityStartET
					row.metadata.ValidityEndET = provenance.ValidityEndET
					row.metadata.ValidityPresent = provenance.ValidityPresent
					stateCopy := state
					row.state, row.exact = &stateCopy, true
					row.metadata.Model, row.metadata.StateEvidence = "spk-original", "catalog-kernel"
					exact++
					continue
				}
			}
			row.metadata.MissingReason = row.catalogBody.MissingReason
			if reason := s.catalog.KernelMissingReason(row.catalogBody.ID); reason != "" {
				row.metadata.MissingReason = reason
			}
			if row.metadata.MissingReason == "" {
				row.metadata.MissingReason = "kernel-coverage-gap"
			}
			missing++
			continue
		}
		if row.record != nil {
			result, resolveErr := s.resolveInventoryStateWithOperational(ctx, *row.record, epoch, false, operational, found)
			if resolveErr != nil {
				return nil, 0, 0, resolveErr
			}
			if result.State != nil && (result.Availability == catalog.AvailableOperational || result.Availability == catalog.AvailableSnapshot) && finiteState(*result.State) {
				if result.Model == "spk-original" {
					catalogID := "naif:" + strconv.Itoa(row.record.NAIFID)
					provenance, provenanceOK, provenanceErr := s.catalog.OperationalProvenance(catalogID, epoch)
					if provenanceErr != nil {
						return nil, 0, 0, provenanceErr
					}
					if !provenanceOK {
						row.metadata.MissingReason = "kernel-provenance-unavailable"
						missing++
						continue
					}
					row.metadata.Source = provenance.Source
					row.metadata.KernelSHA256 = provenance.KernelSHA256
					row.metadata.CenterID = provenance.CenterID
					row.metadata.ValidityStartET = provenance.ValidityStartET
					row.metadata.ValidityEndET = provenance.ValidityEndET
					row.metadata.ValidityPresent = provenance.ValidityPresent
				} else if result.Model == "source-kernel-state-at-audit-epoch" {
					segment, segmentOK := matchingEvidenceSegment(*row.record)
					kernelHash, hashOK := "", false
					if segmentOK {
						kernelHash, hashOK = s.catalog.KernelSHA256(segment.KernelID)
					}
					if !segmentOK || !hashOK {
						row.metadata.MissingReason = "kernel-provenance-unavailable"
						missing++
						continue
					}
					row.metadata.Source = segment.KernelID
					row.metadata.KernelSHA256 = kernelHash
					if segment.Center != 0 {
						row.metadata.CenterID = "naif:" + strconv.Itoa(segment.Center)
					}
				}
				stateCopy := *result.State
				row.state, row.exact = &stateCopy, true
				row.metadata.Model, row.metadata.StateEvidence = result.Model, result.Evidence
				if result.EvidenceWindow != nil {
					row.metadata.EvidenceWindowStartET = result.EvidenceWindow["startEt"]
					row.metadata.EvidenceWindowEndET = result.EvidenceWindow["endEt"]
					row.metadata.EvidenceWindowPresent = true
					row.metadata.ValidityStartET, row.metadata.ValidityEndET, row.metadata.ValidityPresent = row.metadata.EvidenceWindowStartET, row.metadata.EvidenceWindowEndET, true
				}
				exact++
				continue
			}
			row.metadata.MissingReason = result.MissingReason
			if row.metadata.MissingReason == "" {
				row.metadata.MissingReason = missingInventoryStateReason(*row.record)
			}
		}
		missing++
	}
	return rows, exact, missing, nil
}

func (s *Server) catalogOperationalStates(ctx context.Context, ids []string, epoch float64) (map[string]catalog.State, map[string]bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	// Catalog's resolver is shared by plan and tile-era endpoints. It is
	// synchronous, so check cancellation on both sides of the bounded call.
	states, found, err := s.catalog.OperationalStatesContext(ctx, ids, epoch)
	if err != nil {
		return nil, nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	return states, found, nil
}

func (s *Server) stateTiles(w http.ResponseWriter, r *http.Request) {
	var req stateTileRequest
	if err := decodeOneJSON(r, &req); err != nil || req.PlanID == "" {
		s.error(w, http.StatusBadRequest, "invalid_tile_request", "planId and sequence are required")
		return
	}
	plan, ok := s.plans.get(req.PlanID)
	if !ok {
		s.error(w, http.StatusNotFound, "plan_not_found", "state plan is missing or expired")
		return
	}
	if int(req.Sequence) >= len(plan.response.Tiles) {
		s.error(w, http.StatusBadRequest, "invalid_sequence", "tile sequence is outside the plan")
		return
	}
	cacheKey := req.PlanID + ":" + strconv.FormatUint(uint64(req.Sequence), 10)
	if cached, ok := s.tiles.get(cacheKey); ok {
		if err := r.Context().Err(); err != nil {
			s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
			return
		}
		writeStateTile(w, cached.raw, cached.etag)
		return
	}
	select {
	case s.tileSlots <- struct{}{}:
		defer func() { <-s.tileSlots }()
	default:
		w.Header().Set("Retry-After", "1")
		s.error(w, http.StatusTooManyRequests, "overloaded", "tile calculation limit reached; retry later")
		return
	}
	if err := r.Context().Err(); err != nil {
		s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
		return
	}
	// A concurrent miss may have filled the response while this request was
	// waiting for the bounded encoder slot. Reuse it without allocating the
	// tile a second time.
	if cached, ok := s.tiles.peek(cacheKey); ok {
		writeStateTile(w, cached.raw, cached.etag)
		return
	}
	tile := plan.response.Tiles[req.Sequence]
	start, end := int(tile.OrdinalStart), int(tile.OrdinalStart+tile.OrdinalCount)
	rows := plan.rows[start:end]
	metadata := make([]statewire.Metadata, len(rows))
	exactBits := make([]bool, len(rows))
	approxBits := make([]bool, len(rows))
	missingBits := make([]bool, len(rows))
	states := make([]float64, len(rows)*statewire.Stride)
	for n, row := range rows {
		if err := r.Context().Err(); err != nil {
			s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
			return
		}
		metadata[n] = row.metadata
		if row.exact && row.state != nil && finiteState(*row.state) {
			exactBits[n] = true
			states[n*6], states[n*6+1], states[n*6+2] = row.state.Position.X, row.state.Position.Y, row.state.Position.Z
			states[n*6+3], states[n*6+4], states[n*6+5] = row.state.Velocity.X, row.state.Velocity.Y, row.state.Velocity.Z
		} else {
			missingBits[n] = true
		}
	}
	catalogHash, _ := statewire.ParseHash(plan.response.CatalogManifestSHA256)
	var inventoryHash [32]byte
	if plan.response.InventoryManifestSHA256 != "" {
		inventoryHash, _ = statewire.ParseHash(plan.response.InventoryManifestSHA256)
	}
	maxTileBytes := s.stateTileByteBudget
	if maxTileBytes <= 0 {
		maxTileBytes = maxStateTileBytes
	}
	raw, err := statewire.EncodeLimited(statewire.Tile{Sequence: req.Sequence, TileCount: uint32(plan.response.TileCount), OrdinalStart: tile.OrdinalStart, EpochJD: plan.response.EpochJD, FieldMask: statewire.FieldState, PlanHash: plan.hash, CatalogManifestHash: catalogHash, InventoryManifestHash: inventoryHash, Metadata: metadata, Exact: exactBits, Approximate: approxBits, Missing: missingBits, States: states}, maxTileBytes)
	if err != nil {
		if errors.Is(err, statewire.ErrTooLarge) {
			s.error(w, http.StatusRequestEntityTooLarge, "tile_too_large", "tile exceeds the configured byte limit")
			return
		}
		s.error(w, http.StatusUnprocessableEntity, "encode_tile", err.Error())
		return
	}
	if err := r.Context().Err(); err != nil {
		s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
		return
	}
	sum := sha256.Sum256(raw[200:])
	etag := `"` + fmt.Sprintf("%x", sum[:]) + `"`
	s.tiles.put(cacheKey, stateTileCacheValue{raw: raw, etag: etag})
	writeStateTile(w, raw, etag)
}

func writeStateTile(w http.ResponseWriter, raw []byte, etag string) {
	w.Header().Set("Content-Type", "application/vnd.solar.state-tile+binary")
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	w.Header().Set("ETag", etag)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

// estimateStateTileBudget is kept independent of request resolution so tests
// can exercise both accepted and rejected limits without reading inventory or
// evaluating an SPK.
func estimateStateTileBudget(bodyCount, tileSize int, maxPlanBytes, maxTileBytes int64) ([]statePlanTile, int64, error) {
	if bodyCount < 1 || tileSize < 1 || maxPlanBytes < 0 || maxTileBytes < 0 {
		return nil, 0, fmt.Errorf("invalid state tile budget")
	}
	tileCount := (bodyCount + tileSize - 1) / tileSize
	planEstimate := int64(512) + int64(tileCount)*128
	if planEstimate > maxPlanBytes {
		return nil, 0, fmt.Errorf("plan response exceeds budget")
	}
	estimated := int64(0)
	tiles := make([]statePlanTile, 0, tileCount)
	for sequence, start := 0, 0; start < bodyCount; sequence, start = sequence+1, start+tileSize {
		count := bodyCount - start
		if count > tileSize {
			count = tileSize
		}
		bytes := int64(statewire.HeaderSize) + int64(count*statePlanEstimateRow) + int64((count+7)/8*3) + int64(count*statewire.Stride*8) + 7
		if bytes > maxTileBytes {
			return nil, 0, fmt.Errorf("state tile exceeds budget")
		}
		tiles = append(tiles, statePlanTile{Sequence: uint32(sequence), OrdinalStart: uint32(start), OrdinalCount: uint32(count), EstimatedBytes: bytes})
		estimated += bytes
	}
	return tiles, estimated, nil
}

func decodeOneJSON(r *http.Request, out any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes))
	if err := dec.Decode(out); err != nil {
		return fmt.Errorf("request body is not valid JSON")
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return fmt.Errorf("request body must contain one JSON object")
	}
	return nil
}

func exactModel(body catalog.Body) string {
	if body.Availability == catalog.AvailableOperational {
		return "spk-original"
	}
	if body.Availability == catalog.Missing {
		return "unavailable-no-kernel"
	}
	return "exact-only"
}

func epochWithin(start, end, epoch float64) bool {
	return finite(start) && finite(end) && end >= start && epoch >= 2451545.0+start/86400 && epoch <= 2451545.0+end/86400
}

func epochMatchesEvidence(record inventory.Record, epochJD float64) bool {
	if record.KernelEvidence == nil || !finite(record.KernelEvidence.AuditET) {
		return false
	}
	auditJD := 2451545.0 + record.KernelEvidence.AuditET/86400
	return mathAbs(epochJD-auditJD) < 1e-9 && evidenceTargetMatches(record) && evidenceWindowMatches(record)
}

func matchingEvidenceSegment(record inventory.Record) (inventory.KernelSegment, bool) {
	if record.KernelEvidence == nil {
		return inventory.KernelSegment{}, false
	}
	for _, segment := range record.KernelEvidence.Segments {
		if segment.KernelID != "" && finite(segment.StartET) && finite(segment.EndET) && segment.EndET >= segment.StartET && segment.StartET <= record.KernelEvidence.AuditET && segment.EndET >= record.KernelEvidence.AuditET && segment.Frame == 1 && (segment.Type == 2 || segment.Type == 3 || segment.Type == 17 || segment.Type == 21) {
			return segment, true
		}
	}
	return inventory.KernelSegment{}, false
}

func mathAbs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
