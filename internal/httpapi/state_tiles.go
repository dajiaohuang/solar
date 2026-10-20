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
	"math"
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

var errRequestJSONTooLarge = errors.New("request body exceeds configured byte limit")

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

type statePlanFlight struct {
	done chan struct{}
	plan *statePlan
	err  error
}

type statePlanCache struct {
	mu        sync.Mutex
	max       int
	maxBytes  int64
	bytes     int64
	ttl       time.Duration
	items     map[string]*list.Element
	order     *list.List
	flights   map[string]*statePlanFlight
	hits      uint64
	builds    uint64
	coalesced uint64
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
	mu        sync.Mutex
	maxBytes  int64
	bytes     int64
	hits      uint64
	misses    uint64
	coalesced uint64
	flights   map[string]*stateTileFlight
	items     map[string]*list.Element
	order     *list.List
}

func newStateTileCache(maxBytes int64) *stateTileCache {
	if maxBytes < 1 {
		maxBytes = 1
	}
	return &stateTileCache{maxBytes: maxBytes, items: make(map[string]*list.Element), order: list.New(), flights: make(map[string]*stateTileFlight)}
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
	// Charge the retained buffer capacity, key/ETag text, and a conservative
	// allowance for the entry, list node and map slot. This is cache accounting,
	// not an exact Go-heap or process-RSS measurement.
	weight := int64(cap(value.raw)) + int64(len(key)) + int64(len(value.etag)) + 256
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
	return map[string]uint64{"items": uint64(len(c.items)), "residentBytes": uint64(c.bytes), "maxResidentBytes": uint64(c.maxBytes), "hits": c.hits, "misses": c.misses, "coalesced": c.coalesced, "activeEncodings": uint64(len(c.flights))}
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
	return &statePlanCache{max: max, maxBytes: byteLimit, ttl: statePlanTTL, items: make(map[string]*list.Element), order: list.New(), flights: make(map[string]*statePlanFlight)}
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

// load coalesces identical in-flight plan builds. Each waiter keeps its own
// cancellation; if the builder is cancelled, a remaining waiter may retry
// with its own context instead of inheriting that cancellation.
func (c *statePlanCache) load(ctx context.Context, key string, build func() (*statePlan, error)) (*statePlan, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		c.mu.Lock()
		if element := c.items[key]; element != nil {
			entry := element.Value.(*statePlanCacheEntry)
			if time.Since(entry.used) > c.ttl {
				delete(c.items, key)
				c.bytes -= entry.bytes
				c.order.Remove(element)
			} else {
				entry.used = time.Now()
				c.order.MoveToFront(element)
				c.hits++
				plan := entry.plan
				c.mu.Unlock()
				if err := ctx.Err(); err != nil {
					return nil, err
				}
				return plan, nil
			}
		}
		flight := c.flights[key]
		leader := flight == nil
		if leader {
			flight = &statePlanFlight{done: make(chan struct{})}
			c.flights[key] = flight
			c.builds++
		} else {
			c.coalesced++
		}
		c.mu.Unlock()
		if leader {
			return c.buildFlight(ctx, key, flight, build)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-flight.done:
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if errors.Is(flight.err, context.Canceled) || errors.Is(flight.err, context.DeadlineExceeded) {
			continue
		}
		return flight.plan, flight.err
	}
}

func (c *statePlanCache) buildFlight(ctx context.Context, key string, flight *statePlanFlight, build func() (*statePlan, error)) (plan *statePlan, err error) {
	finished := false
	defer func() {
		c.mu.Lock()
		if finished {
			flight.plan, flight.err = plan, err
		} else {
			flight.err = errors.New("state plan construction interrupted")
		}
		delete(c.flights, key)
		close(flight.done)
		c.mu.Unlock()
	}()
	plan, err = build()
	if cancelled := ctx.Err(); cancelled != nil {
		plan, err = nil, cancelled
	} else if err != nil {
		plan = nil
	}
	finished = true
	return plan, err
}

func (c *statePlanCache) put(key string, plan *statePlan) bool {
	weight := statePlanResidentBytes(plan) + int64(len(key)) + 256
	if plan == nil || weight > c.maxBytes {
		return false
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
	return true
}

func statePlanResidentBytes(plan *statePlan) int64 {
	if plan == nil {
		return 0
	}
	// Account retained slice capacities, not only visible elements. Fixed
	// allowances are conservative cache weights rather than measured heap size.
	bytes := int64(1024) + int64(cap(plan.response.Tiles))*40 + int64(cap(plan.rows))*272 + int64(cap(plan.response.FieldMask))*16
	r := plan.response
	for _, text := range []string{r.APIVersion, r.CatalogVersion, r.CatalogManifestSHA256, r.InventoryManifestSHA256,
		r.RequestIDsSHA256, r.PlanID, r.TimeScale, r.Frame, r.Precision, r.StateOriginID, r.DistanceUnit, r.VelocityUnit} {
		bytes += int64(len(text))
	}
	for _, field := range r.FieldMask {
		bytes += int64(len(field))
	}
	for _, row := range plan.rows {
		metadata := row.metadata
		bytes += int64(len(metadata.ID) + len(metadata.Source) + len(metadata.DatasetVersion) + len(metadata.DatasetSHA256) + len(metadata.KernelSHA256) + len(metadata.SourceChainSHA256) + len(metadata.Model) + len(metadata.CenterID) + len(metadata.StateEvidence) + len(metadata.MissingReason) + len(metadata.IdentityStatus))
		if row.state != nil {
			bytes += statewire.Stride * 8
		}
	}
	return bytes
}

func (c *statePlanCache) stats() (items int, bytes, maxBytes int64, hits, builds, coalesced uint64, active int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items), c.bytes, c.maxBytes, c.hits, c.builds, c.coalesced, len(c.flights)
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
		"limits":                map[string]int{"maxIds": maxStatePlanIDs, "maxPlanBytes": maxStatePlanBytes, "tileSizeMin": 1, "tileSizeMax": maxStateTileBodies, "defaultTileSize": defaultStateTileSize, "maxTileBytes": maxStateTileBytes, "planCacheItems": statePlanCacheItems, "planCacheBytes": statePlanCacheBytes},
	}
	if s.inventory != nil {
		body["inventoryManifestSha256"] = s.inventory.ManifestHash()
	}
	s.json(w, http.StatusOK, body)
}

func (s *Server) statePlan(w http.ResponseWriter, r *http.Request) {
	var req statePlanRequest
	if err := decodeOneJSONLimit(r, &req, maxStatePlanBytes); err != nil {
		if errors.Is(err, errRequestJSONTooLarge) {
			s.error(w, http.StatusRequestEntityTooLarge, "plan_too_large", "state-plan request exceeds its configured JSON byte budget")
			return
		}
		s.error(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	ids, err := normalizePlanRequest(&req)
	if err != nil {
		s.error(w, http.StatusBadRequest, "invalid_plan", err.Error())
		return
	}
	plan, err := s.buildStatePlan(r.Context(), req, ids)
	if err != nil {
		s.stateWorkError(w, r, err)
		return
	}
	s.jsonLimited(w, http.StatusOK, plan.response, maxStatePlanBytes)
}

func (s *Server) stateWorkError(w http.ResponseWriter, r *http.Request, err error) {
	var failure *stateTileBuildError
	if r.Context().Err() != nil {
		s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
	} else if errors.Is(err, errRequestQueueFull) || errors.Is(err, errRequestQueueTimeout) {
		w.Header().Set("Retry-After", "1")
		s.error(w, http.StatusTooManyRequests, "overloaded", "compute queue unavailable; retry later")
	} else if errors.As(err, &failure) {
		s.error(w, failure.status, failure.code, failure.message)
	} else {
		s.error(w, http.StatusUnprocessableEntity, "state_unavailable", err.Error())
	}
}

func (s *Server) buildStatePlan(ctx context.Context, req statePlanRequest, ids []string) (*statePlan, error) {
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
	return s.plans.load(ctx, planID, func() (*statePlan, error) {
		// This estimate is deliberately conservative and is checked before any
		// inventory read or SPK/Kepler calculation occurs.
		maxTileBytes := s.stateTileByteBudget
		if maxTileBytes <= 0 {
			maxTileBytes = maxStateTileBytes
		}
		tiles, estimated, err := estimateStateTileBudget(len(ids), req.TileSize, maxStatePlanBytes, maxTileBytes)
		if err != nil {
			return nil, &stateTileBuildError{http.StatusRequestEntityTooLarge, "plan_too_large", "estimated state tile response exceeds the configured budget"}
		}
		tileCount := len(tiles)
		rows, exact, missing, err := s.preparePlanRows(ctx, ids, req.EpochJD, planHash)
		if err != nil {
			return nil, err
		}
		response := statePlanResponse{APIVersion: catalog.APIVersion, CatalogVersion: s.catalog.Version(), CatalogManifestSHA256: s.catalog.ManifestHash(), PlanID: planID, EpochJD: req.EpochJD, TimeScale: req.TimeScale, Frame: req.Frame, Precision: req.Precision, StateOriginID: "naif:0", DistanceUnit: "km", VelocityUnit: "km/s", FieldMask: append([]string(nil), req.FieldMask...), BodyCount: len(ids), Stride: statewire.Stride, TileSize: req.TileSize, TileCount: tileCount, ExactCount: exact, ApproximateCount: 0, MissingCount: missing, EstimatedBytes: estimated, Tiles: tiles}
		response.RequestIDsSHA256 = requestIDsHash(ids)
		if s.inventory != nil {
			response.InventoryManifestSHA256 = s.inventory.ManifestHash()
		}
		plan := &statePlan{response: response, rows: rows, hash: planHash, created: time.Now()}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !s.plans.put(planID, plan) {
			return nil, &stateTileBuildError{http.StatusRequestEntityTooLarge, "plan_too_large", "resolved state plan exceeds the resident cache budget; request fewer bodies"}
		}
		return plan, nil
	})
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
	const blockSize = 1024
	if len(ids) <= blockSize {
		return s.preparePlanBlock(ctx, ids, epoch)
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	rows := make([]statePlanRow, len(ids))
	blocks := (len(ids) + blockSize - 1) / blockSize
	jobs := make(chan int)
	var workers sync.WaitGroup
	var failure error
	var once sync.Once
	for worker := 0; worker < min(4, blocks); worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for block := range jobs {
				start := block * blockSize
				end := min(start+blockSize, len(ids))
				resolved, _, _, err := s.preparePlanBlock(ctx, ids[start:end], epoch)
				if err != nil {
					once.Do(func() { failure = err; cancel() })
					return
				}
				copy(rows[start:end], resolved)
			}
		}()
	}
dispatch:
	for block := 0; block < blocks; block++ {
		select {
		case <-ctx.Done():
			break dispatch
		case jobs <- block:
		}
	}
	close(jobs)
	workers.Wait()
	if failure != nil {
		return nil, 0, 0, failure
	}
	if err := ctx.Err(); err != nil {
		return nil, 0, 0, err
	}
	exact := 0
	for _, row := range rows {
		if row.exact {
			exact++
		}
	}
	return rows, exact, len(rows) - exact, nil
}

func (s *Server) preparePlanBlock(ctx context.Context, ids []string, epoch float64) ([]statePlanRow, int, int, error) {
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
	operational, found, evidence, err := s.catalogOperationalStates(ctx, operationalIDs, epoch)
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
					provenance, provenanceOK := evidence[row.catalogBody.ID]
					if !provenanceOK || strings.TrimSpace(provenance.Source) == "" || !validProvenanceSHA256(provenance.KernelSHA256) {
						row.metadata.MissingReason = "kernel-provenance-unavailable"
						missing++
						continue
					}
					if !validProvenanceSHA256(provenance.SourceChainSHA256) {
						row.metadata.MissingReason = "source-chain-provenance-unavailable"
						missing++
						continue
					}
					row.metadata.Source = provenance.Source
					row.metadata.KernelSHA256 = provenance.KernelSHA256
					row.metadata.SourceChainSHA256 = provenance.SourceChainSHA256
					// All states in this plan are barycentric ECLIPJ2000 states;
					// the selected segment's center is not the resolved state's origin.
					row.metadata.CenterID = "naif:0"
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
			result, resolveErr := s.resolveInventoryStateWithOperational(ctx, *row.record, epoch, operational, found, evidence)
			if resolveErr != nil {
				return nil, 0, 0, resolveErr
			}
			if result.State != nil && (result.Availability == catalog.AvailableOperational || result.Availability == catalog.AvailableSnapshot) && finiteState(*result.State) {
				if result.Model == "spk-original" {
					catalogID := "naif:" + strconv.Itoa(row.record.NAIFID)
					provenance, provenanceOK := evidence[catalogID]
					if !provenanceOK || strings.TrimSpace(provenance.Source) == "" || !validProvenanceSHA256(provenance.KernelSHA256) {
						row.metadata.MissingReason = "kernel-provenance-unavailable"
						missing++
						continue
					}
					if !validProvenanceSHA256(provenance.SourceChainSHA256) {
						row.metadata.MissingReason = "source-chain-provenance-unavailable"
						missing++
						continue
					}
					row.metadata.Source = provenance.Source
					row.metadata.KernelSHA256 = provenance.KernelSHA256
					row.metadata.SourceChainSHA256 = provenance.SourceChainSHA256
					// Inventory identities use the same barycentric state contract.
					row.metadata.CenterID = "naif:0"
					row.metadata.ValidityStartET = provenance.ValidityStartET
					row.metadata.ValidityEndET = provenance.ValidityEndET
					row.metadata.ValidityPresent = provenance.ValidityPresent
				} else if result.Model == "source-kernel-state-at-audit-epoch" {
					segment, segmentOK := matchingEvidenceSegment(*row.record)
					kernelHash, hashOK := "", false
					if segmentOK {
						kernelHash, hashOK = s.catalog.KernelSHA256(segment.KernelID)
					}
					if !segmentOK || !hashOK || kernelHash != row.record.KernelEvidence.SourceKernelSHA256 {
						row.metadata.MissingReason = "kernel-provenance-unavailable"
						missing++
						continue
					}
					if strings.TrimSpace(row.record.IdentityStatus) == "" {
						row.metadata.MissingReason = "source-identity-status-unavailable"
						missing++
						continue
					}
					if !validProvenanceSHA256(row.record.KernelEvidence.SourceChainSHA256) {
						row.metadata.MissingReason = "source-chain-provenance-unavailable"
						missing++
						continue
					}
					row.metadata.Source = segment.KernelID
					row.metadata.KernelSHA256 = kernelHash
					row.metadata.SourceChainSHA256 = row.record.KernelEvidence.SourceChainSHA256
					// Inventory snapshots store barycentric coordinates evaluated from
					// the same recursively resolved source pool.
					row.metadata.CenterID = "naif:0"
					row.metadata.ValidityStartET = row.record.KernelEvidence.AuditET
					row.metadata.ValidityEndET = row.record.KernelEvidence.AuditET
					row.metadata.ValidityPresent = finite(row.record.KernelEvidence.AuditET)
				}
				stateCopy := *result.State
				row.state, row.exact = &stateCopy, true
				row.metadata.Model, row.metadata.StateEvidence = result.Model, result.Evidence
				if result.EvidenceWindow != nil {
					row.metadata.EvidenceWindowStartET = result.EvidenceWindow["startEt"]
					row.metadata.EvidenceWindowEndET = result.EvidenceWindow["endEt"]
					row.metadata.EvidenceWindowPresent = true
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

func (s *Server) catalogOperationalStates(ctx context.Context, ids []string, epoch float64) (map[string]catalog.State, map[string]bool, map[string]catalog.OperationalProvenance, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, nil, err
	}
	// Catalog's resolver is shared by plan and tile-era endpoints. It is
	// synchronous, so check cancellation on both sides of the bounded call.
	class := computeClass(ctx)
	states, found, evidence, err := s.catalog.EvalBatchContextWithAdmission(ctx, ids, epoch, strconv.Itoa(int(class)),
		func(evalCtx context.Context) (func(), error) { return s.compute.acquire(evalCtx, class) })
	if err != nil {
		return nil, nil, nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, nil, err
	}
	return states, found, evidence, nil
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
	value, err := s.tiles.load(r.Context(), cacheKey, func() (stateTileCacheValue, error) {
		return s.encodeStateTile(r.Context(), plan, req.Sequence)
	})
	if err != nil {
		var failure *stateTileBuildError
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
		} else if errors.As(err, &failure) {
			if failure.status == http.StatusTooManyRequests {
				w.Header().Set("Retry-After", "1")
			}
			s.error(w, failure.status, failure.code, failure.message)
		} else {
			s.error(w, http.StatusUnprocessableEntity, "encode_tile", err.Error())
		}
		return
	}
	writeStateTile(w, value.raw, value.etag)
}

func (s *Server) encodeStateTile(ctx context.Context, plan *statePlan, sequence uint32) (stateTileCacheValue, error) {
	return s.encodeStateTileWithWait(ctx, plan, sequence, false)
}

func (s *Server) encodeStateTileWithWait(ctx context.Context, plan *statePlan, sequence uint32, wait bool) (stateTileCacheValue, error) {
	select {
	case s.tileSlots <- struct{}{}:
	default:
		if !wait {
			return stateTileCacheValue{}, &stateTileBuildError{http.StatusTooManyRequests, "overloaded", "tile calculation limit reached; retry later"}
		}
		timer := time.NewTimer(requestQueueTimeout)
		defer timer.Stop()
		select {
		case s.tileSlots <- struct{}{}:
		case <-ctx.Done():
			return stateTileCacheValue{}, ctx.Err()
		case <-timer.C:
			return stateTileCacheValue{}, errRequestQueueTimeout
		}
	}
	defer func() { <-s.tileSlots }()
	if err := ctx.Err(); err != nil {
		return stateTileCacheValue{}, err
	}
	tile := plan.response.Tiles[sequence]
	start, end := int(tile.OrdinalStart), int(tile.OrdinalStart+tile.OrdinalCount)
	rows := plan.rows[start:end]
	metadata := make([]statewire.Metadata, len(rows))
	exactBits := make([]bool, len(rows))
	approxBits := make([]bool, len(rows))
	missingBits := make([]bool, len(rows))
	states := make([]float64, len(rows)*statewire.Stride)
	for n, row := range rows {
		if err := ctx.Err(); err != nil {
			return stateTileCacheValue{}, err
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
	raw, err := statewire.EncodeLimited(statewire.Tile{Sequence: sequence, TileCount: uint32(plan.response.TileCount), OrdinalStart: tile.OrdinalStart, EpochJD: plan.response.EpochJD, FieldMask: statewire.FieldState, PlanHash: plan.hash, CatalogManifestHash: catalogHash, InventoryManifestHash: inventoryHash, Metadata: metadata, Exact: exactBits, Approximate: approxBits, Missing: missingBits, States: states}, maxTileBytes)
	if err != nil {
		if errors.Is(err, statewire.ErrTooLarge) {
			return stateTileCacheValue{}, &stateTileBuildError{http.StatusRequestEntityTooLarge, "tile_too_large", "tile exceeds the configured byte limit"}
		}
		return stateTileCacheValue{}, err
	}
	if err := ctx.Err(); err != nil {
		return stateTileCacheValue{}, err
	}
	sum := sha256.Sum256(raw[statewire.HeaderSize:])
	etag := `"` + fmt.Sprintf("%x", sum[:]) + `"`
	return stateTileCacheValue{raw: raw, etag: etag}, nil
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
	return decodeOneJSONLimit(r, out, maxBodyBytes)
}

func decodeOneJSONLimit(r *http.Request, out any, maximum int64) error {
	// LimitReader fabricates EOF at the limit, accepting a valid prefix even
	// when another JSON value or oversized whitespace follows it.
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maximum))
	if err := dec.Decode(out); err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			return errRequestJSONTooLarge
		}
		return fmt.Errorf("request body is not valid JSON")
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			return errRequestJSONTooLarge
		}
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

func epochMatchesEvidence(record inventory.Record, epochJD float64) bool {
	if record.KernelEvidence == nil || !finite(record.KernelEvidence.AuditET) || !finite(epochJD) {
		return false
	}
	epochET := (epochJD - 2451545.0) * 86400.0
	return finite(epochET) && math.Abs(epochET-record.KernelEvidence.AuditET) <= statewire.EpochRoundingAllowanceETSeconds && evidenceTargetMatches(record) && evidenceWindowMatches(record)
}

func matchingEvidenceSegment(record inventory.Record) (inventory.KernelSegment, bool) {
	if record.KernelEvidence == nil || record.KernelEvidence.SourceSegment == nil {
		return inventory.KernelSegment{}, false
	}
	segment := *record.KernelEvidence.SourceSegment
	if segment.KernelID == "" || !finite(segment.StartET) || !finite(segment.EndET) || segment.EndET < segment.StartET || segment.StartET > record.KernelEvidence.AuditET || segment.EndET < record.KernelEvidence.AuditET || (segment.Frame != 1 && segment.Frame != 17) || (segment.Type != 1 && segment.Type != 2 && segment.Type != 3 && segment.Type != 17 && segment.Type != 21) {
		return inventory.KernelSegment{}, false
	}
	listed := false
	for _, candidate := range record.KernelEvidence.Segments {
		if candidate == segment {
			listed = true
			break
		}
	}
	if !listed {
		return inventory.KernelSegment{}, false
	}
	return segment, true
}
