// Package inventory indexes the audited all-body source inventory without
// materialising raw records in the runtime catalog. Inventory membership is
// intentionally not unique-body selectability or ephemeris availability.
package inventory

import (
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
)

const (
	// The index is deliberately bounded by a declared input size. Raising this
	// limit requires a measured memory decision, not an accidental allocation.
	MaxIndexedRecords = 2_000_000
	MaxIndexPostings  = 12_000_000
	MaxShardBytes     = 64 << 20
	MaxShards         = 10_000
	idPostingBit      = uint32(1 << 31)
)

type shard struct {
	File   string `json:"file"`
	Count  int    `json:"count"`
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type manifest struct {
	SchemaVersion int     `json:"schemaVersion"`
	Purpose       string  `json:"purpose"`
	TotalRecords  int     `json:"totalRecords"`
	Shards        []shard `json:"shards"`
}

type recordRef struct {
	Shard   uint32
	Row     uint32
	Ordinal uint32
}

type indexFields struct {
	ID              string   `json:"id"`
	Designation     string   `json:"designation"`
	Name            string   `json:"name"`
	Category        string   `json:"category"`
	ParentID        string   `json:"parentId"`
	Confirmation    string   `json:"confirmation"`
	IdentityStatus  string   `json:"identityStatus"`
	EphemerisStatus string   `json:"ephemerisStatus"`
	Source          string   `json:"source"`
	Aliases         []string `json:"aliases"`
}

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
	dir  string
	m    manifest
	hash string
	idx  *sourceIndex
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
	if m.SchemaVersion != 1 || m.Purpose != "source-inventory-not-runtime-catalog" || m.TotalRecords < 0 || len(m.Shards) == 0 || len(m.Shards) > MaxShards {
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
		if s.Count < 0 || s.Count > 10000 || s.Bytes < 0 {
			return nil, fmt.Errorf("invalid inventory shard metadata")
		}
	}
	sum := sha256.Sum256(raw)
	i := &Inventory{dir: abs, m: m, hash: hex.EncodeToString(sum[:])}
	if err := i.buildIndex(); err != nil {
		return nil, err
	}
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
		err := i.walkShard(si, true, func(row int, raw []byte) error {
			var fields indexFields
			if err := json.Unmarshal(raw, &fields); err != nil {
				return fmt.Errorf("parse inventory row %d/%d: %w", si, row, err)
			}
			if fields.ID == "" {
				return fmt.Errorf("inventory row %d/%d has no stable id", si, row)
			}
			ref := recordRef{Shard: uint32(si), Row: uint32(row), Ordinal: ordinal}
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
	shards := make([]int, 0, len(refs))
	seenShards := make(map[int]struct{})
	for pos, ref := range refs {
		key := refKey(ref)
		positions[key] = append(positions[key], pos)
		if _, ok := seenShards[int(ref.Shard)]; !ok {
			seenShards[int(ref.Shard)] = struct{}{}
			shards = append(shards, int(ref.Shard))
		}
	}
	sort.Ints(shards)
	for _, si := range shards {
		remaining := 0
		for key := range positions {
			if uint32(key>>32) == uint32(si) {
				remaining++
			}
		}
		err := i.walkShard(si, false, func(row int, raw []byte) error {
			if row%128 == 0 {
				select {
				case <-ctx.Done():
					return ctx.Err()
				default:
				}
			}
			key := refKey(recordRef{Shard: uint32(si), Row: uint32(row)})
			positionsForRow := positions[key]
			for _, pos := range positionsForRow {
				out[pos] = append(json.RawMessage(nil), raw...)
			}
			if len(positionsForRow) > 0 {
				delete(positions, key)
				remaining--
				if remaining == 0 {
					return io.EOF
				}
			}
			return nil
		})
		if err != nil && err != io.EOF {
			return nil, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
	}
	return out, nil
}

func (i *Inventory) readRef(ctx context.Context, ref recordRef) (json.RawMessage, error) {
	var out json.RawMessage
	err := i.walkShard(int(ref.Shard), false, func(row int, raw []byte) error {
		if row%128 == 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}
		}
		if uint32(row) == ref.Row {
			out = append(json.RawMessage(nil), raw...)
			return io.EOF
		}
		return nil
	})
	if err != nil && err != io.EOF {
		return nil, err
	}
	if out == nil {
		return nil, fmt.Errorf("inventory row %d/%d not found", ref.Shard, ref.Row)
	}
	return out, nil
}

func (i *Inventory) walkShard(si int, verify bool, fn func(row int, raw []byte) error) error {
	if si < 0 || si >= len(i.m.Shards) {
		return fmt.Errorf("inventory shard out of range")
	}
	s := i.m.Shards[si]
	path := filepath.Join(i.dir, s.File)
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat inventory shard: %w", err)
	}
	if info.Size() > MaxShardBytes {
		return fmt.Errorf("inventory shard %s exceeds %d-byte limit", s.File, MaxShardBytes)
	}
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open inventory shard: %w", err)
	}
	defer file.Close()
	var reader io.Reader = file
	var counted *countingReader
	var digest hash.Hash
	if verify {
		counted = &countingReader{Reader: file}
		digest = sha256.New()
		reader = io.TeeReader(counted, digest)
	}
	gz, err := gzip.NewReader(reader)
	if err != nil {
		return fmt.Errorf("open inventory gzip: %w", err)
	}
	scan := bufio.NewScanner(gz)
	scan.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for row := 0; scan.Scan(); row++ {
		if err := fn(row, scan.Bytes()); err != nil {
			return err
		}
	}
	if err := scan.Err(); err != nil {
		_ = gz.Close()
		return fmt.Errorf("scan inventory shard: %w", err)
	}
	if err := gz.Close(); err != nil {
		return fmt.Errorf("close inventory gzip: %w", err)
	}
	if verify {
		if counted.n != info.Size() || (s.Bytes > 0 && counted.n != int64(s.Bytes)) {
			return fmt.Errorf("inventory shard %s byte count mismatch", s.File)
		}
		if s.SHA256 != "" && hex.EncodeToString(digest.Sum(nil)) != s.SHA256 {
			return fmt.Errorf("inventory shard %s hash mismatch", s.File)
		}
	}
	return nil
}

type countingReader struct {
	io.Reader
	n int64
}

func (r *countingReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	r.n += int64(n)
	return n, err
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

func refKey(ref recordRef) uint64 { return uint64(ref.Shard)<<32 | uint64(ref.Row) }
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
