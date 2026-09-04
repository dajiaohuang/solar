// Package inventory streams the audited all-body source inventory without
// materialising 1.5M records in the runtime catalog. Inventory membership is
// intentionally not unique-body selectability or ephemeris availability.
package inventory

import (
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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
type Inventory struct {
	dir  string
	m    manifest
	hash string
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
	if m.SchemaVersion != 1 || m.Purpose != "source-inventory-not-runtime-catalog" || m.TotalRecords < 0 || len(m.Shards) == 0 {
		return nil, fmt.Errorf("invalid source inventory manifest")
	}
	for _, s := range m.Shards {
		if s.File == "" || filepath.IsAbs(s.File) || filepath.Clean(s.File) != s.File || strings.HasPrefix(s.File, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("invalid inventory shard path")
		}
	}
	sum := sha256.Sum256(raw)
	return &Inventory{dir: abs, m: m, hash: hex.EncodeToString(sum[:])}, nil
}
func (i *Inventory) TotalRecords() int    { return i.m.TotalRecords }
func (i *Inventory) ManifestHash() string { return i.hash }
func (i *Inventory) ShardCount() int      { return len(i.m.Shards) }

// Page returns raw source records to preserve fields and forward compatibility.
// Cursor is opaque and identifies a shard plus row offset; rows are never
// silently deduplicated or promoted to unique scientific bodies.
func (i *Inventory) Page(ctx context.Context, cursor, query string, limit int) ([]json.RawMessage, string, error) {
	if limit < 1 || limit > 500 {
		return nil, "", fmt.Errorf("limit must be between 1 and 500")
	}
	si, ri, err := decodeCursor(cursor)
	if err != nil {
		return nil, "", err
	}
	q := strings.ToLower(strings.TrimSpace(query))
	out := make([]json.RawMessage, 0, limit)
	for si < len(i.m.Shards) {
		select {
		case <-ctx.Done():
			return nil, "", ctx.Err()
		default:
		}
		s := i.m.Shards[si]
		f, err := os.Open(filepath.Join(i.dir, s.File))
		if err != nil {
			return nil, "", fmt.Errorf("open inventory shard: %w", err)
		}
		gz, err := gzip.NewReader(f)
		if err != nil {
			f.Close()
			return nil, "", fmt.Errorf("open inventory gzip: %w", err)
		}
		scan := bufio.NewScanner(gz)
		scan.Buffer(make([]byte, 64*1024), 4*1024*1024)
		row := 0
		for scan.Scan() {
			if row < ri {
				row++
				continue
			}
			raw := append(json.RawMessage(nil), scan.Bytes()...)
			row++
			if q != "" && !recordMatches(raw, q) {
				continue
			}
			out = append(out, raw)
			if len(out) >= limit {
				gz.Close()
				f.Close()
				nextShard, nextRow := si, row
				if row >= s.Count {
					nextShard++
					nextRow = 0
				}
				if nextShard >= len(i.m.Shards) {
					return out, "", nil
				}
				return out, encodeCursor(nextShard, nextRow), nil
			}
			if row%128 == 0 {
				select {
				case <-ctx.Done():
					gz.Close()
					f.Close()
					return nil, "", ctx.Err()
				default:
				}
			}
		}
		scanErr := scan.Err()
		gzErr := gz.Close()
		f.Close()
		if scanErr != nil {
			return nil, "", fmt.Errorf("scan inventory shard: %w", scanErr)
		}
		if gzErr != nil {
			return nil, "", fmt.Errorf("close inventory gzip: %w", gzErr)
		}
		si++
		ri = 0
	}
	return out, "", nil
}
func recordMatches(raw []byte, q string) bool {
	var v struct{ ID, Designation, Name, Category, IdentityStatus, EphemerisStatus string }
	if json.Unmarshal(raw, &v) != nil {
		return false
	}
	return strings.Contains(strings.ToLower(v.ID+" "+v.Designation+" "+v.Name+" "+v.Category+" "+v.IdentityStatus+" "+v.EphemerisStatus), q)
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
