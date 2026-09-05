// Package inventory indexes the audited all-body source inventory without
// materialising raw records in the runtime catalog. Inventory membership is
// intentionally not unique-body selectability or ephemeris availability.
package inventory

import (
	"bytes"
	"compress/gzip"
	"container/list"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
)

const (
	// The index is deliberately bounded by a declared input size. Raising this
	// limit requires a measured memory decision, not an accidental allocation.
	MaxIndexedRecords = 2_000_000
	MaxIndexPostings  = 12_000_000
	MaxShardBytes     = 64 << 20
	MaxShards         = 10_000
	MaxBlockRows      = 512
	MaxBlockBytes     = 8 << 20
	MaxBlockRawBytes  = 16 << 20
	BlockCacheBytes   = 64 << 20
	idPostingBit      = uint32(1 << 31)
)

type block struct {
	RowStart          int    `json:"rowStart"`
	Count             int    `json:"count"`
	Offset            int64  `json:"offset"`
	Bytes             int    `json:"bytes"`
	UncompressedBytes int    `json:"uncompressedBytes"`
	SHA256            string `json:"sha256"`
}

type shard struct {
	File   string  `json:"file"`
	Count  int     `json:"count"`
	Bytes  int     `json:"bytes"`
	SHA256 string  `json:"sha256"`
	Blocks []block `json:"blocks"`
}

type manifest struct {
	SchemaVersion int     `json:"schemaVersion"`
	Purpose       string  `json:"purpose"`
	TotalRecords  int     `json:"totalRecords"`
	Shards        []shard `json:"shards"`
}

type recordRef struct {
	Shard   uint32
	Block   uint16
	Row     uint32
	Ordinal uint32
}

type indexFields struct {
	ID              string               `json:"id"`
	Designation     string               `json:"designation"`
	Name            string               `json:"name"`
	Category        string               `json:"category"`
	ParentID        string               `json:"parentId"`
	Confirmation    string               `json:"confirmation"`
	IdentityStatus  string               `json:"identityStatus"`
	EphemerisStatus string               `json:"ephemerisStatus"`
	Source          string               `json:"source"`
	Aliases         []string             `json:"aliases"`
	NAIFID          int                  `json:"naifId"`
	KernelEvidence  *indexKernelEvidence `json:"kernelEvidence"`
}

// indexKernelEvidence is the small subset needed to advertise exact
// current-state identities. Avoid decoding Orbit and other large source
// fields for every one of the 1.5M rows during startup.
type indexKernelEvidence struct {
	AuditET           float64              `json:"auditEt"`
	Target            int                  `json:"target"`
	Segments          []indexKernelSegment `json:"segments"`
	StateAtAuditEpoch *indexEvidenceState  `json:"stateAtAuditEpoch"`
}
type indexKernelSegment struct {
	KernelID string  `json:"kernelId"`
	StartET  float64 `json:"startEt"`
	EndET    float64 `json:"endEt"`
	Frame    int     `json:"frame"`
	Type     int     `json:"type"`
}
type indexEvidenceState struct {
	Position indexVector `json:"position"`
	Velocity indexVector `json:"velocity"`
}
type indexVector struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

func validIndexSnapshotEvidence(fields indexFields) bool {
	e := fields.KernelEvidence
	if e == nil || e.StateAtAuditEpoch == nil || !finiteIndex(e.AuditET) || (e.Target != 0 && fields.NAIFID != 0 && e.Target != fields.NAIFID) {
		return false
	}
	s := e.StateAtAuditEpoch
	if !finiteIndex(s.Position.X) || !finiteIndex(s.Position.Y) || !finiteIndex(s.Position.Z) || !finiteIndex(s.Velocity.X) || !finiteIndex(s.Velocity.Y) || !finiteIndex(s.Velocity.Z) {
		return false
	}
	for _, segment := range e.Segments {
		if segment.KernelID != "" && finiteIndex(segment.StartET) && finiteIndex(segment.EndET) && segment.EndET >= segment.StartET && segment.StartET <= e.AuditET && segment.EndET >= e.AuditET && segment.Frame == 1 && (segment.Type == 2 || segment.Type == 3 || segment.Type == 17 || segment.Type == 21) {
			return true
		}
	}
	return false
}

func finiteIndex(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

// termPair is packed to 12 bytes so the temporary sort buffer does not pay
// Go's 16-byte struct alignment for a uint64 plus uint32 posting.
type termPair [12]byte

func makeTermPair(hash uint64, ordinal uint32) termPair {
	var pair termPair
	binary.LittleEndian.PutUint64(pair[:8], hash)
	binary.LittleEndian.PutUint32(pair[8:], ordinal)
	return pair
}

func termPairHash(pair termPair) uint64    { return binary.LittleEndian.Uint64(pair[:8]) }
func termPairOrdinal(pair termPair) uint32 { return binary.LittleEndian.Uint32(pair[8:]) }

type sourceIndex struct {
	records     []recordRef
	shardStarts []uint32
	termPairs   []termPair
	termKeys    []uint64
	termStarts  []uint32
	termRefs    []uint32
}

type Inventory struct {
	dir     string
	m       manifest
	hash    string
	idx     *sourceIndex
	sources map[string]struct{}
	models  map[string]map[string]struct{}
	blocks  *blockCache
}

type decodedBlock struct {
	data   []byte
	starts []uint32
}

type blockCacheEntry struct {
	key   uint64
	block *decodedBlock
	bytes int64
}

type blockCache struct {
	mu          sync.Mutex
	maxBytes    int64
	bytes       int64
	hits        uint64
	misses      uint64
	loads       uint64
	loadedBytes uint64
	items       map[uint64]*list.Element
	order       *list.List
}

func newBlockCache(maxBytes int64) *blockCache {
	return &blockCache{maxBytes: maxBytes, items: make(map[uint64]*list.Element), order: list.New()}
}

func (c *blockCache) get(key uint64) (*decodedBlock, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e := c.items[key]
	if e == nil {
		c.misses++
		return nil, false
	}
	c.hits++
	c.order.MoveToFront(e)
	return e.Value.(*blockCacheEntry).block, true
}

func (c *blockCache) put(key uint64, value *decodedBlock) {
	weight := int64(len(value.data) + len(value.starts)*4)
	if weight > c.maxBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.loads++
	c.loadedBytes += uint64(len(value.data))
	if e := c.items[key]; e != nil {
		entry := e.Value.(*blockCacheEntry)
		c.bytes -= entry.bytes
		entry.block, entry.bytes = value, weight
		c.bytes += weight
		c.order.MoveToFront(e)
	} else {
		e := c.order.PushFront(&blockCacheEntry{key: key, block: value, bytes: weight})
		c.items[key] = e
		c.bytes += weight
	}
	for c.bytes > c.maxBytes {
		e := c.order.Back()
		entry := e.Value.(*blockCacheEntry)
		delete(c.items, entry.key)
		c.bytes -= entry.bytes
		c.order.Remove(e)
	}
}

func (c *blockCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bytes = 0
	c.hits = 0
	c.misses = 0
	c.loads = 0
	c.loadedBytes = 0
	c.items = make(map[uint64]*list.Element)
	c.order.Init()
}

func (c *blockCache) stats() map[string]int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return map[string]int64{"entries": int64(len(c.items)), "residentBytes": c.bytes, "maxResidentBytes": c.maxBytes, "hits": int64(c.hits), "misses": int64(c.misses), "loads": int64(c.loads), "loadedBytes": int64(c.loadedBytes)}
}

func Load(dir string) (*Inventory, error) {
	if dir == "" {
		return nil, fmt.Errorf("inventory directory is empty")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(filepath.Join(abs, "manifest.json"))
	if err != nil {
		return nil, fmt.Errorf("read inventory manifest: %w", err)
	}
	var m manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("parse inventory manifest: %w", err)
	}
	if m.SchemaVersion != 2 || m.Purpose != "source-inventory-addressable-v2" || m.TotalRecords < 0 || len(m.Shards) == 0 || len(m.Shards) > MaxShards {
		return nil, fmt.Errorf("invalid source inventory manifest")
	}
	if m.TotalRecords > MaxIndexedRecords {
		return nil, fmt.Errorf("inventory has %d records; index limit is %d", m.TotalRecords, MaxIndexedRecords)
	}
	for _, s := range m.Shards {
		clean := filepath.Clean(s.File)
		if s.File == "" || filepath.IsAbs(s.File) || clean != s.File || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("invalid inventory shard path")
		}
		if s.Count < 1 || s.Count > 10000 || s.Bytes < 1 || s.Bytes > MaxShardBytes || !validSHA256(s.SHA256) || len(s.Blocks) < 1 || len(s.Blocks) > 65535 {
			return nil, fmt.Errorf("invalid inventory shard metadata")
		}
		rowStart, offset := 0, int64(0)
		for _, b := range s.Blocks {
			if b.RowStart != rowStart || b.Offset != offset || b.Count < 1 || b.Count > MaxBlockRows || b.Bytes < 1 || b.Bytes > MaxBlockBytes || b.UncompressedBytes < 1 || b.UncompressedBytes > MaxBlockRawBytes || !validSHA256(b.SHA256) {
				return nil, fmt.Errorf("invalid inventory block metadata")
			}
			rowStart += b.Count
			offset += int64(b.Bytes)
		}
		if rowStart != s.Count || offset != int64(s.Bytes) {
			return nil, fmt.Errorf("inventory block coverage mismatch")
		}
	}
	sum := sha256.Sum256(raw)
	i := &Inventory{dir: abs, m: m, hash: hex.EncodeToString(sum[:]), sources: make(map[string]struct{}), models: make(map[string]map[string]struct{}), blocks: newBlockCache(BlockCacheBytes)}
	if err := i.buildIndex(); err != nil {
		return nil, err
	}
	i.blocks.clear()
	return i, nil
}

func (i *Inventory) TotalRecords() int    { return i.m.TotalRecords }
func (i *Inventory) ManifestHash() string { return i.hash }
func (i *Inventory) ShardCount() int      { return len(i.m.Shards) }
func (i *Inventory) TotalBytes() int64 {
	var total int64
	for _, s := range i.m.Shards {
		total += int64(s.Bytes)
	}
	return total
}

func (i *Inventory) BlockCacheStats() map[string]int64 { return i.blocks.stats() }

// IndexStats exposes bounded startup-index evidence without exposing mutable
// internal maps to callers.
func (i *Inventory) IndexStats() map[string]int {
	terms, postings := 0, 0
	indexed := 0
	if i.idx != nil {
		terms = len(i.idx.termKeys)
		postings = len(i.idx.termRefs)
		indexed = len(i.idx.records)
	}
	return map[string]int{"indexedRecords": indexed, "searchTerms": terms, "indexPostings": postings, "maxIndexedRecords": MaxIndexedRecords, "maxIndexPostings": MaxIndexPostings}
}

// SourceIdentities reports source labels collected while the bounded startup
// index was built; serving capabilities never rescans the inventory shards.
func (i *Inventory) SourceIdentities() []string {
	values := make([]string, 0, len(i.sources))
	for source := range i.sources {
		values = append(values, source)
	}
	sort.Strings(values)
	return values
}

// SourceIdentityModels reports only model combinations observed or selected
// by the exact current-state resolver during the bounded startup index pass.
func (i *Inventory) SourceIdentityModels() map[string][]string {
	out := make(map[string][]string, len(i.models))
	for source, models := range i.models {
		values := make([]string, 0, len(models))
		for model := range models {
			values = append(values, model)
		}
		sort.Strings(values)
		out[source] = values
	}
	return out
}

// Page returns raw source records in stable source order. Empty-query pages
// use a shard/row cursor; searched pages use a query-bound cursor over the
// prebuilt exact normalized identity/alias index. Rows are never silently
// deduplicated or promoted.
func (i *Inventory) Page(ctx context.Context, cursor, query string, limit int) ([]json.RawMessage, string, error) {
	refs, next, err := i.pageRefs(cursor, query, limit)
	if err != nil {
		return nil, "", err
	}
	rows, err := i.readRefs(ctx, refs)
	if err != nil {
		return nil, "", err
	}
	return rows, next, nil
}

// Get returns one source row by its stable source identity. Hash buckets are
// verified against the raw ID before returning, so a hash collision cannot
// select the wrong record.
func (i *Inventory) Get(ctx context.Context, id string) (json.RawMessage, bool, error) {
	id = strings.TrimSpace(id)
	if id == "" || i.idx == nil {
		return nil, false, nil
	}
	for _, encodedOrdinal := range i.postings(hashText(normalize(id))) {
		ordinal := encodedOrdinal &^ idPostingBit
		ref := i.idx.records[ordinal]
		row, err := i.readRef(ctx, ref)
		if err != nil {
			return nil, false, err
		}
		var fields indexFields
		if err := json.Unmarshal(row, &fields); err != nil {
			return nil, false, fmt.Errorf("parse inventory row: %w", err)
		}
		if fields.ID == id {
			return row, true, nil
		}
	}
	return nil, false, nil
}

// GetMany resolves stable source IDs in one grouped read. Candidate rows are
// collected from the exact ID postings, then read once per shard; the raw ID
// is still verified after the read so hash collisions cannot select a record.
// The returned map contains only IDs that were found and preserves the source
// row bytes for callers that need untouched evidence.
func (i *Inventory) GetMany(ctx context.Context, ids []string) (map[string]json.RawMessage, error) {
	return i.getMany(ctx, ids, nil)
}

// GetManyWithOrdinals binds evidence references to the actual indexed row,
// using the same grouped reads as GetMany rather than scanning the inventory.
func (i *Inventory) GetManyWithOrdinals(ctx context.Context, ids []string) (map[string]json.RawMessage, map[string]int, error) {
	ordinals := make(map[string]int, len(ids))
	rows, err := i.getMany(ctx, ids, ordinals)
	return rows, ordinals, err
}

func (i *Inventory) getMany(ctx context.Context, ids []string, ordinals map[string]int) (map[string]json.RawMessage, error) {
	out := make(map[string]json.RawMessage, len(ids))
	if i == nil || i.idx == nil || len(ids) == 0 {
		return out, nil
	}
	refsByKey := make(map[uint64]recordRef)
	wanted := make(map[uint64][]string)
	for _, rawID := range ids {
		id := strings.TrimSpace(rawID)
		if id == "" {
			continue
		}
		for _, encodedOrdinal := range i.postings(hashText(normalize(id))) {
			if encodedOrdinal&idPostingBit == 0 {
				continue
			}
			ordinal := encodedOrdinal &^ idPostingBit
			if int(ordinal) >= len(i.idx.records) {
				continue
			}
			ref := i.idx.records[ordinal]
			key := refKey(ref)
			refsByKey[key] = ref
			wanted[key] = append(wanted[key], id)
		}
	}
	if len(refsByKey) == 0 {
		return out, nil
	}
	refs := make([]recordRef, 0, len(refsByKey))
	for _, ref := range refsByKey {
		refs = append(refs, ref)
	}
	sort.Slice(refs, func(a, b int) bool {
		if refs[a].Shard != refs[b].Shard {
			return refs[a].Shard < refs[b].Shard
		}
		return refs[a].Row < refs[b].Row
	})
	rows, err := i.readRefs(ctx, refs)
	if err != nil {
		return nil, err
	}
	for n, ref := range refs {
		if rows[n] == nil {
			continue
		}
		var fields indexFields
		if err := json.Unmarshal(rows[n], &fields); err != nil {
			return nil, fmt.Errorf("parse inventory row: %w", err)
		}
		for _, id := range wanted[refKey(ref)] {
			if fields.ID == id {
				out[id] = append(json.RawMessage(nil), rows[n]...)
				if ordinals != nil {
					ordinals[id] = int(ref.Ordinal)
				}
			}
		}
	}
	return out, nil
}

func (i *Inventory) pageRefs(cursor, query string, limit int) ([]recordRef, string, error) {
	if limit < 1 || limit > 500 {
		return nil, "", fmt.Errorf("limit must be between 1 and 500")
	}
	q := normalize(query)
	if q == "" {
		shardID, row, err := decodeCursor(cursor)
		if err != nil {
			return nil, "", err
		}
		if shardID > len(i.m.Shards) || (shardID == len(i.m.Shards) && row != 0) {
			return nil, "", fmt.Errorf("invalid inventory page token")
		}
		start := uint32(len(i.idx.records))
		if shardID < len(i.m.Shards) {
			if row > i.m.Shards[shardID].Count {
				return nil, "", fmt.Errorf("invalid inventory page token")
			}
			start = i.idx.shardStarts[shardID] + uint32(row)
		}
		if start >= uint32(len(i.idx.records)) {
			return nil, "", nil
		}
		end := start + uint32(limit)
		if end > uint32(len(i.idx.records)) {
			end = uint32(len(i.idx.records))
		}
		refs := append([]recordRef(nil), i.idx.records[start:end]...)
		if end == uint32(len(i.idx.records)) {
			return refs, "", nil
		}
		next := i.idx.records[end]
		return refs, encodeCursor(int(next.Shard), int(next.Row)), nil
	}

	offset, tokenHash, err := decodeSearchCursor(cursor)
	if err != nil {
		return nil, "", err
	}
	if tokenHash != 0 && tokenHash != hashText(q) {
		return nil, "", fmt.Errorf("inventory page token does not match query")
	}
	ordinals := i.search(q)
	if offset > len(ordinals) {
		return nil, "", fmt.Errorf("invalid inventory page token")
	}
	end := offset + limit
	if end > len(ordinals) {
		end = len(ordinals)
	}
	out := make([]recordRef, 0, end-offset)
	for _, encodedOrdinal := range ordinals[offset:end] {
		ordinal := encodedOrdinal &^ idPostingBit
		out = append(out, i.idx.records[ordinal])
	}
	if end == len(ordinals) {
		return out, "", nil
	}
	return out, encodeSearchCursor(q, end), nil
}

func (i *Inventory) postings(hash uint64) []uint32 {
	if i.idx == nil {
		return nil
	}
	pos := sort.Search(len(i.idx.termKeys), func(n int) bool { return i.idx.termKeys[n] >= hash })
	if pos == len(i.idx.termKeys) || i.idx.termKeys[pos] != hash {
		return nil
	}
	return i.idx.termRefs[i.idx.termStarts[pos]:i.idx.termStarts[pos+1]]
}

func (i *Inventory) search(query string) []uint32 {
	q := normalize(query)
	if q == "" {
		out := make([]uint32, len(i.idx.records))
		for n := range out {
			out[n] = uint32(n)
		}
		return out
	}
	if refs := i.postings(hashText(q)); len(refs) > 0 {
		return refs
	}
	return nil
}

func (i *Inventory) buildIndex() error {
	idx := &sourceIndex{
		records:     make([]recordRef, 0, i.m.TotalRecords),
		shardStarts: make([]uint32, len(i.m.Shards)+1),
		termPairs:   make([]termPair, 0, minInt(MaxIndexPostings, i.m.TotalRecords*6)),
	}
	var ordinal uint32
	indexOverflow := false
	for si, s := range i.m.Shards {
		idx.shardStarts[si] = ordinal
		rowCount := 0
		err := i.walkShard(si, true, func(blockIndex, row int, raw []byte) error {
			var fields indexFields
			if err := json.Unmarshal(raw, &fields); err != nil {
				return fmt.Errorf("parse inventory row %d/%d: %w", si, row, err)
			}
			if fields.ID == "" {
				return fmt.Errorf("inventory row %d/%d has no stable id", si, row)
			}
			if fields.Source != "" {
				i.sources[fields.Source] = struct{}{}
				models := i.models[fields.Source]
				if models == nil {
					models = make(map[string]struct{})
					i.models[fields.Source] = models
				}
				// Every exact request can produce an explicit missing row. The
				// other models are added only when this row carries the evidence
				// that selects them; this is not a source×model cartesian product.
				models["exact-only"] = struct{}{}
				if validIndexSnapshotEvidence(fields) {
					models["source-kernel-state-at-audit-epoch"] = struct{}{}
				}
			}
			ref := recordRef{Shard: uint32(si), Block: uint16(blockIndex), Row: uint32(row), Ordinal: ordinal}
			idx.records = append(idx.records, ref)
			var seen [24]uint64
			seenCount := 0
			add := func(value string, isID bool) {
				value = normalize(value)
				if value == "" {
					return
				}
				h := hashText(value)
				already := false
				for n := 0; n < seenCount; n++ {
					if seen[n] == h {
						already = true
						break
					}
				}
				if !already {
					if len(idx.termPairs) >= MaxIndexPostings {
						indexOverflow = true
						return
					}
					posting := ordinal
					if isID {
						posting |= idPostingBit
					}
					idx.termPairs = append(idx.termPairs, makeTermPair(h, posting))
					if seenCount < len(seen) {
						seen[seenCount] = h
						seenCount++
					}
				}
			}
			add(fields.ID, true)
			add(fields.Designation, false)
			add(fields.Name, false)
			for _, alias := range fields.Aliases {
				add(alias, false)
			}
			ordinal++
			rowCount++
			return nil
		})
		if err != nil {
			return err
		}
		if indexOverflow {
			return fmt.Errorf("inventory index exceeds %d postings", MaxIndexPostings)
		}
		if rowCount != s.Count {
			return fmt.Errorf("inventory shard %s row count %d != manifest %d", s.File, rowCount, s.Count)
		}
	}
	idx.shardStarts[len(i.m.Shards)] = ordinal
	if int(ordinal) != i.m.TotalRecords || len(idx.records) != i.m.TotalRecords {
		return fmt.Errorf("inventory total %d != manifest %d", ordinal, i.m.TotalRecords)
	}
	sort.Slice(idx.termPairs, func(a, b int) bool {
		aHash, bHash := termPairHash(idx.termPairs[a]), termPairHash(idx.termPairs[b])
		if aHash != bHash {
			return aHash < bHash
		}
		return (termPairOrdinal(idx.termPairs[a]) &^ idPostingBit) < (termPairOrdinal(idx.termPairs[b]) &^ idPostingBit)
	})
	idx.termKeys = make([]uint64, 0, len(idx.termPairs))
	idx.termStarts = make([]uint32, 0, len(idx.termPairs)+1)
	idx.termRefs = make([]uint32, len(idx.termPairs))
	for n, pair := range idx.termPairs {
		pairHash := termPairHash(pair)
		if n == 0 || pairHash != termPairHash(idx.termPairs[n-1]) {
			idx.termKeys = append(idx.termKeys, pairHash)
			idx.termStarts = append(idx.termStarts, uint32(n))
		}
		idx.termRefs[n] = termPairOrdinal(pair)
	}
	idx.termStarts = append(idx.termStarts, uint32(len(idx.termPairs)))
	idx.termPairs = nil
	i.idx = idx
	// Release the temporary sortable pair buffer before serving requests. The
	// explicit collection keeps the steady-state index bounded after a large
	// source replay rather than waiting for a later request to trigger GC.
	runtime.GC()
	debug.FreeOSMemory()
	return nil
}

func (i *Inventory) readRefs(ctx context.Context, refs []recordRef) ([]json.RawMessage, error) {
	if len(refs) == 0 {
		return []json.RawMessage{}, nil
	}
	out := make([]json.RawMessage, len(refs))
	positions := make(map[uint64][]int, len(refs))
	blockRefs := make(map[uint64][]recordRef)
	for pos, ref := range refs {
		key := refKey(ref)
		positions[key] = append(positions[key], pos)
		key = blockKey(int(ref.Shard), int(ref.Block))
		blockRefs[key] = append(blockRefs[key], ref)
	}
	keys := make([]uint64, 0, len(blockRefs))
	for key := range blockRefs {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(a, b int) bool { return keys[a] < keys[b] })
	for _, key := range keys {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		si, bi := int(key>>32), int(uint32(key))
		decoded, err := i.readBlock(ctx, si, bi)
		if err != nil {
			return nil, err
		}
		for _, ref := range blockRefs[key] {
			raw, ok := blockRow(decoded, i.m.Shards[si].Blocks[bi], int(ref.Row))
			if !ok {
				return nil, fmt.Errorf("inventory row %d/%d not found", ref.Shard, ref.Row)
			}
			for _, pos := range positions[refKey(ref)] {
				out[pos] = append(json.RawMessage(nil), raw...)
			}
		}
	}
	return out, nil
}

func (i *Inventory) readRef(ctx context.Context, ref recordRef) (json.RawMessage, error) {
	if int(ref.Shard) >= len(i.m.Shards) || int(ref.Block) >= len(i.m.Shards[ref.Shard].Blocks) {
		return nil, fmt.Errorf("inventory reference out of range")
	}
	decoded, err := i.readBlock(ctx, int(ref.Shard), int(ref.Block))
	if err != nil {
		return nil, err
	}
	raw, ok := blockRow(decoded, i.m.Shards[ref.Shard].Blocks[ref.Block], int(ref.Row))
	if !ok {
		return nil, fmt.Errorf("inventory row %d/%d not found", ref.Shard, ref.Row)
	}
	return append(json.RawMessage(nil), raw...), nil
}

func (i *Inventory) walkShard(si int, verify bool, fn func(blockIndex, row int, raw []byte) error) error {
	if si < 0 || si >= len(i.m.Shards) {
		return fmt.Errorf("inventory shard out of range")
	}
	s := i.m.Shards[si]
	path := filepath.Join(i.dir, s.File)
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat inventory shard: %w", err)
	}
	if verify {
		if info.Size() != int64(s.Bytes) {
			return fmt.Errorf("inventory shard %s byte count mismatch", s.File)
		}
		file, openErr := os.Open(path)
		if openErr != nil {
			return fmt.Errorf("open inventory shard: %w", openErr)
		}
		digest := sha256.New()
		_, copyErr := io.Copy(digest, io.LimitReader(file, MaxShardBytes+1))
		closeErr := file.Close()
		if copyErr != nil || closeErr != nil || hex.EncodeToString(digest.Sum(nil)) != s.SHA256 {
			return fmt.Errorf("inventory shard %s hash mismatch", s.File)
		}
	}
	for bi, b := range s.Blocks {
		decoded, err := i.readBlock(context.Background(), si, bi)
		if err != nil {
			return err
		}
		for row := 0; row < b.Count; row++ {
			if err := fn(bi, b.RowStart+row, decoded.data[decoded.starts[row]:decoded.starts[row+1]-1]); err != nil {
				return err
			}
		}
	}
	return nil
}

func (i *Inventory) readBlock(ctx context.Context, si, bi int) (*decodedBlock, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if si < 0 || si >= len(i.m.Shards) || bi < 0 || bi >= len(i.m.Shards[si].Blocks) {
		return nil, fmt.Errorf("inventory block out of range")
	}
	key := blockKey(si, bi)
	if cached, ok := i.blocks.get(key); ok {
		return cached, nil
	}
	b := i.m.Shards[si].Blocks[bi]
	file, err := os.Open(filepath.Join(i.dir, i.m.Shards[si].File))
	if err != nil {
		return nil, fmt.Errorf("open inventory shard: %w", err)
	}
	compressed := make([]byte, b.Bytes)
	_, readErr := file.ReadAt(compressed, b.Offset)
	closeErr := file.Close()
	if readErr != nil || closeErr != nil {
		return nil, fmt.Errorf("read inventory block: %v", readErr)
	}
	sum := sha256.Sum256(compressed)
	if hex.EncodeToString(sum[:]) != b.SHA256 {
		return nil, fmt.Errorf("inventory block hash mismatch")
	}
	gz, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, fmt.Errorf("open inventory block gzip: %w", err)
	}
	data, readErr := io.ReadAll(io.LimitReader(gz, int64(MaxBlockRawBytes)+1))
	closeErr = gz.Close()
	if readErr != nil || closeErr != nil || len(data) != b.UncompressedBytes || len(data) > MaxBlockRawBytes || len(data) == 0 || data[len(data)-1] != '\n' {
		return nil, fmt.Errorf("invalid inventory block payload")
	}
	starts := make([]uint32, 1, b.Count+1)
	for n, value := range data {
		if value == '\n' {
			starts = append(starts, uint32(n+1))
		}
	}
	if len(starts) != b.Count+1 {
		return nil, fmt.Errorf("inventory block row count mismatch")
	}
	decoded := &decodedBlock{data: data, starts: starts}
	i.blocks.put(key, decoded)
	return decoded, nil
}

func normalize(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(value)), " "))
}

func hashText(value string) uint64 {
	const (
		offset = 1469598103934665603
		prime  = 1099511628211
	)
	h := uint64(offset)
	for j := 0; j < len(value); j++ {
		h ^= uint64(value[j])
		h *= prime
	}
	return h
}

func refKey(ref recordRef) uint64      { return uint64(ref.Shard)<<32 | uint64(ref.Row) }
func blockKey(shard, block int) uint64 { return uint64(uint32(shard))<<32 | uint64(uint32(block)) }
func blockRow(decoded *decodedBlock, meta block, globalRow int) ([]byte, bool) {
	local := globalRow - meta.RowStart
	if decoded == nil || local < 0 || local >= meta.Count || local+1 >= len(decoded.starts) {
		return nil, false
	}
	start, end := decoded.starts[local], decoded.starts[local+1]
	if end <= start || decoded.data[end-1] != '\n' {
		return nil, false
	}
	return decoded.data[start : end-1], true
}
func validSHA256(value string) bool {
	if len(value) != sha256.Size*2 || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func encodeCursor(shard, row int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(shard) + ":" + strconv.Itoa(row)))
}

func decodeCursor(token string) (int, int, error) {
	if token == "" {
		return 0, 0, nil
	}
	b, e := base64.RawURLEncoding.DecodeString(token)
	if e != nil {
		return 0, 0, fmt.Errorf("invalid inventory page token")
	}
	p := strings.Split(string(b), ":")
	if len(p) != 2 {
		return 0, 0, fmt.Errorf("invalid inventory page token")
	}
	s, e1 := strconv.Atoi(p[0])
	r, e2 := strconv.Atoi(p[1])
	if e1 != nil || e2 != nil || s < 0 || r < 0 {
		return 0, 0, fmt.Errorf("invalid inventory page token")
	}
	return s, r, nil
}

func encodeSearchCursor(query string, offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("q:%016x:%d", hashText(normalize(query)), offset)))
}

func decodeSearchCursor(token string) (int, uint64, error) {
	if token == "" {
		return 0, 0, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return 0, 0, fmt.Errorf("invalid inventory page token")
	}
	p := strings.Split(string(b), ":")
	if len(p) != 3 || p[0] != "q" {
		return 0, 0, fmt.Errorf("invalid inventory page token")
	}
	h, err1 := strconv.ParseUint(p[1], 16, 64)
	offset, err2 := strconv.Atoi(p[2])
	if err1 != nil || err2 != nil || offset < 0 {
		return 0, 0, fmt.Errorf("invalid inventory page token")
	}
	return offset, h, nil
}
