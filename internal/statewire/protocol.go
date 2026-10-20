// Package statewire defines the versioned binary state-tile envelope.
package statewire

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"
)

const (
	HeaderSize  = 208
	WireVersion = 2
	Stride      = 6
	FieldState  = 3 // position (1) | velocity (2)
	// Contract identifiers are stable wire enums. Version 2 carries them in
	// every tile so consumers can interpret the Float64 state without the plan.
	TimeScaleTDB    = 1
	FrameEclipJ2000 = 1
	OriginNAIF0     = 1
	DistanceUnitKM  = 1
	VelocityUnitKMS = 1
	MaxRows         = 32768
	// EpochRoundingAllowanceETSeconds bounds JD/ET Float64 round-trip drift in
	// state metadata checks; it is not an SPK coverage extrapolation margin.
	EpochRoundingAllowanceETSeconds = 0.0001
)

var magic = [8]byte{'S', 'L', 'R', 'T', 'I', 'L', 'E', 0}

// ErrTooLarge indicates that a tile cannot be encoded within the configured
// resident/wire byte budget. Callers can map it to HTTP 413 without treating
// it as a malformed scientific row.
var ErrTooLarge = errors.New("state tile exceeds byte limit")

type Metadata struct {
	ID                    string  `json:"id"`
	Source                string  `json:"source"`
	DatasetVersion        string  `json:"datasetVersion"`
	DatasetSHA256         string  `json:"datasetSha256"`
	KernelSHA256          string  `json:"kernelSha256"`
	SourceChainSHA256     string  `json:"sourceChainSha256,omitempty"`
	Model                 string  `json:"model"`
	CenterID              string  `json:"centerId"`
	ValidityStartET       float64 `json:"validityStartEt"`
	ValidityEndET         float64 `json:"validityEndEt"`
	ValidityPresent       bool    `json:"validityPresent"`
	StateEvidence         string  `json:"stateEvidence"`
	EvidenceWindowStartET float64 `json:"evidenceWindowStartEt"`
	EvidenceWindowEndET   float64 `json:"evidenceWindowEndEt"`
	EvidenceWindowPresent bool    `json:"evidenceWindowPresent"`
	MissingReason         string  `json:"missingReason"`
	IdentityStatus        string  `json:"identityStatus"`
	SourceRecord          bool    `json:"sourceRecord"`
}

type Tile struct {
	Sequence              uint32
	TileCount             uint32
	OrdinalStart          uint32
	EpochJD               float64
	FieldMask             uint16
	PlanHash              [32]byte
	CatalogManifestHash   [32]byte
	InventoryManifestHash [32]byte
	Metadata              []Metadata
	Exact                 []bool
	Approximate           []bool
	Missing               []bool
	States                []float64
}

// Encode serializes a tile without wrapping the state payload in a JSON
// object. Metadata is JSON by design so source evidence can evolve without
// changing the fixed binary header.
func Encode(tile Tile) ([]byte, error) {
	return EncodeLimited(tile, 0)
}

// EncodeLimited serializes one tile into a single final wire buffer. Metadata
// is written directly into its final section; the payload is hashed in place,
// so no metadata aggregate, payload buffer, or result copy is retained.
// A positive maxBytes is checked against a conservative escaped-JSON bound
// before allocating the final buffer and again while metadata is accumulated.
func EncodeLimited(tile Tile, maxBytes int64) ([]byte, error) {
	n := len(tile.Metadata)
	if n < 1 || n > MaxRows || len(tile.Exact) != n || len(tile.Approximate) != n || len(tile.Missing) != n {
		return nil, fmt.Errorf("invalid tile row/bitmap lengths")
	}
	if tile.FieldMask != FieldState || !finite(tile.EpochJD) || tile.TileCount == 0 || tile.Sequence >= tile.TileCount {
		return nil, fmt.Errorf("invalid tile header fields")
	}
	if len(tile.States) != n*Stride {
		return nil, fmt.Errorf("invalid tile state length")
	}
	epochET := (tile.EpochJD - 2451545.0) * 86400.0
	for row := 0; row < n; row++ {
		if tile.Exact[row] && tile.Missing[row] || tile.Exact[row] && tile.Approximate[row] || tile.Approximate[row] && tile.Missing[row] {
			return nil, fmt.Errorf("tile status bitmaps overlap at row %d", row)
		}
		if !tile.Exact[row] && !tile.Approximate[row] && !tile.Missing[row] {
			return nil, fmt.Errorf("tile row %d has no status", row)
		}
		if tile.Approximate[row] {
			return nil, fmt.Errorf("tile row %d is approximate in exact-only wire", row)
		}
		metadata := tile.Metadata[row]
		if metadata.ValidityPresent && (!finite(metadata.ValidityStartET) || !finite(metadata.ValidityEndET) || metadata.ValidityEndET < metadata.ValidityStartET) {
			return nil, fmt.Errorf("tile row %d validity window is invalid", row)
		}
		if metadata.EvidenceWindowPresent && (!finite(metadata.EvidenceWindowStartET) || !finite(metadata.EvidenceWindowEndET) || metadata.EvidenceWindowEndET < metadata.EvidenceWindowStartET) {
			return nil, fmt.Errorf("tile row %d evidence window is invalid", row)
		}
		if metadata.SourceChainSHA256 != "" && !validHash(metadata.SourceChainSHA256) {
			return nil, fmt.Errorf("tile row %d source-chain provenance is invalid", row)
		}
		if strings.TrimSpace(metadata.ID) == "" {
			return nil, fmt.Errorf("tile row %d has no identity", row)
		}
		if tile.Exact[row] {
			if strings.TrimSpace(metadata.Source) == "" || strings.TrimSpace(metadata.DatasetVersion) == "" || !validHash(metadata.DatasetSHA256) || !validHash(metadata.SourceChainSHA256) || strings.TrimSpace(metadata.StateEvidence) == "" || metadata.CenterID != "naif:0" || (metadata.Model != "spk-original" && metadata.Model != "source-kernel-state-at-audit-epoch") {
				return nil, fmt.Errorf("tile row %d exact provenance is invalid", row)
			}
			expectedDatasetHash := tile.CatalogManifestHash
			if metadata.SourceRecord {
				expectedDatasetHash = tile.InventoryManifestHash
			}
			if expectedDatasetHash == ([32]byte{}) || metadata.DatasetSHA256 != HashHex(expectedDatasetHash) {
				return nil, fmt.Errorf("tile row %d dataset provenance is not bound to its manifest", row)
			}
			if !validHash(metadata.KernelSHA256) {
				return nil, fmt.Errorf("tile row %d kernel provenance is invalid", row)
			}
			if metadata.Model == "source-kernel-state-at-audit-epoch" && (!metadata.SourceRecord || strings.TrimSpace(metadata.IdentityStatus) == "") {
				return nil, fmt.Errorf("tile row %d snapshot identity provenance is invalid", row)
			}
			if metadata.ValidityPresent && (epochET < metadata.ValidityStartET-EpochRoundingAllowanceETSeconds || epochET > metadata.ValidityEndET+EpochRoundingAllowanceETSeconds) {
				return nil, fmt.Errorf("tile row %d state falls outside its validity window", row)
			}
			if metadata.EvidenceWindowPresent && (epochET < metadata.EvidenceWindowStartET-EpochRoundingAllowanceETSeconds || epochET > metadata.EvidenceWindowEndET+EpochRoundingAllowanceETSeconds) {
				return nil, fmt.Errorf("tile row %d state falls outside its evidence window", row)
			}
			if metadata.MissingReason != "" {
				return nil, fmt.Errorf("tile row %d exact state has missing reason", row)
			}
		} else if strings.TrimSpace(metadata.MissingReason) == "" {
			return nil, fmt.Errorf("tile row %d missing state has no reason", row)
		}
		for component := 0; component < Stride; component++ {
			value := tile.States[row*Stride+component]
			if !finite(value) {
				return nil, fmt.Errorf("nonfinite tile state at row %d component %d", row, component)
			}
			if tile.Missing[row] && value != 0 {
				return nil, fmt.Errorf("nonzero missing tile state at row %d component %d", row, component)
			}
		}
	}
	bitmapBytes := (n + 7) / 8
	statesLength := n * Stride * 8
	metadataLimit, err := metadataUpperBound(tile.Metadata)
	if err != nil {
		return nil, err
	}
	upperStatesOffset, ok := addInt64Aligned(int64(HeaderSize) + metadataLimit + int64(bitmapBytes*3))
	if !ok || int64(statesLength) > math.MaxInt64-upperStatesOffset {
		return nil, fmt.Errorf("%w: size overflows int64", ErrTooLarge)
	}
	upperTotal := upperStatesOffset + int64(statesLength)
	if maxBytes > 0 && upperTotal > maxBytes {
		return nil, fmt.Errorf("%w: conservative estimate %d exceeds %d", ErrTooLarge, upperTotal, maxBytes)
	}
	if uint64(upperTotal) > uint64(maxInt()) {
		return nil, fmt.Errorf("%w: size exceeds platform limit", ErrTooLarge)
	}
	result := make([]byte, int(upperTotal))
	metadataPos := HeaderSize
	metadataUsed := int64(0)
	for _, row := range tile.Metadata {
		raw, marshalErr := json.Marshal(row)
		if marshalErr != nil {
			return nil, fmt.Errorf("encode tile metadata: %w", marshalErr)
		}
		if int64(len(raw))+1 > metadataLimit-metadataUsed {
			return nil, fmt.Errorf("%w: metadata exceeds conservative estimate", ErrTooLarge)
		}
		copy(result[metadataPos:], raw)
		metadataPos += len(raw)
		result[metadataPos] = '\n'
		metadataPos++
		metadataUsed += int64(len(raw) + 1)
	}
	metadataLength := metadataPos - HeaderSize
	metadataOffset := HeaderSize
	exactOffset := metadataPos
	approxOffset := exactOffset + bitmapBytes
	missingOffset := approxOffset + bitmapBytes
	statesOffset := align8(missingOffset + bitmapBytes)
	total := statesOffset + statesLength
	if maxBytes > 0 && int64(total) > maxBytes {
		return nil, fmt.Errorf("%w: encoded size %d exceeds %d", ErrTooLarge, total, maxBytes)
	}
	writeBitmap(result[exactOffset:approxOffset], tile.Exact)
	writeBitmap(result[approxOffset:missingOffset], tile.Approximate)
	writeBitmap(result[missingOffset:statesOffset], tile.Missing)
	for n, value := range tile.States {
		binary.LittleEndian.PutUint64(result[statesOffset+n*8:], math.Float64bits(value))
	}
	result = result[:total]
	payloadHash := sha256.Sum256(result[HeaderSize:])
	copy(result[:8], magic[:])
	binary.LittleEndian.PutUint16(result[8:], WireVersion)
	binary.LittleEndian.PutUint16(result[10:], HeaderSize)
	binary.LittleEndian.PutUint32(result[12:], tile.Sequence)
	binary.LittleEndian.PutUint32(result[16:], tile.TileCount)
	binary.LittleEndian.PutUint32(result[20:], tile.OrdinalStart)
	binary.LittleEndian.PutUint32(result[24:], uint32(n))
	binary.LittleEndian.PutUint16(result[28:], Stride)
	binary.LittleEndian.PutUint16(result[30:], tile.FieldMask)
	binary.LittleEndian.PutUint64(result[32:], math.Float64bits(tile.EpochJD))
	binary.LittleEndian.PutUint32(result[40:], uint32(metadataOffset))
	binary.LittleEndian.PutUint32(result[44:], uint32(metadataLength))
	binary.LittleEndian.PutUint32(result[48:], uint32(exactOffset))
	binary.LittleEndian.PutUint32(result[52:], uint32(bitmapBytes))
	binary.LittleEndian.PutUint32(result[56:], uint32(approxOffset))
	binary.LittleEndian.PutUint32(result[60:], uint32(missingOffset))
	binary.LittleEndian.PutUint32(result[64:], uint32(statesOffset))
	binary.LittleEndian.PutUint32(result[68:], uint32(statesLength))
	copy(result[72:104], tile.PlanHash[:])
	copy(result[104:136], tile.CatalogManifestHash[:])
	copy(result[136:168], tile.InventoryManifestHash[:])
	copy(result[168:200], payloadHash[:])
	result[200] = TimeScaleTDB
	result[201] = FrameEclipJ2000
	result[202] = OriginNAIF0
	result[203] = DistanceUnitKM
	result[204] = VelocityUnitKMS
	return result, nil
}

func metadataUpperBound(rows []Metadata) (int64, error) {
	var total int64
	for _, row := range rows {
		// Fixed JSON punctuation, keys, four finite numbers, three booleans,
		// and the trailing NDJSON newline. String bounds account for JSON
		// quotes, control/HTML escapes, valid UTF-8 and invalid-byte repair.
		rowSize := int64(544 + 1)
		for _, value := range []string{row.ID, row.Source, row.DatasetVersion, row.DatasetSHA256, row.KernelSHA256, row.SourceChainSHA256, row.Model, row.CenterID, row.StateEvidence, row.MissingReason, row.IdentityStatus} {
			encoded, ok := jsonStringUpperBound(value)
			if !ok || rowSize > math.MaxInt64-encoded {
				return 0, fmt.Errorf("%w: metadata size overflows int64", ErrTooLarge)
			}
			rowSize += encoded
		}
		if total > math.MaxInt64-rowSize {
			return 0, fmt.Errorf("%w: metadata size overflows int64", ErrTooLarge)
		}
		total += rowSize
	}
	return total, nil
}

func jsonStringUpperBound(value string) (int64, bool) {
	total := int64(2) // JSON quotes
	for pos := 0; pos < len(value); {
		r, size := utf8.DecodeRuneInString(value[pos:])
		if r == utf8.RuneError && size == 1 {
			size = 1
			if total > math.MaxInt64-3 {
				return 0, false
			}
			total += 3
			pos += size
			continue
		}
		encoded := int64(size)
		switch {
		case r < 0x20, r == '"', r == '\\', r == '<', r == '>', r == '&', r == '\u2028', r == '\u2029':
			encoded = 6
		}
		if total > math.MaxInt64-encoded {
			return 0, false
		}
		total += encoded
		pos += size
	}
	return total, true
}

func addInt64Aligned(value int64) (int64, bool) {
	if value < 0 || value > math.MaxInt64-7 {
		return 0, false
	}
	return (value + 7) &^ 7, true
}

func maxInt() int { return int(^uint(0) >> 1) }

// Header returns the fixed header fields used by tests and transport code.
// It intentionally does not decode metadata or state values.
type Header struct {
	Sequence, TileCount, OrdinalStart, RecordCount                      uint32
	Stride, FieldMask                                                   uint16
	EpochJD                                                             float64
	MetadataOffset, MetadataLength                                      uint32
	ExactBitmapOffset, BitmapLength                                     uint32
	ApproxBitmapOffset, MissingBitmapOffset                             uint32
	StatesOffset, StatesLength                                          uint32
	PlanHash, CatalogManifestHash, InventoryManifestHash, PayloadSHA256 [32]byte
	TimeScaleID, FrameID, OriginID, DistanceUnitID, VelocityUnitID      uint8
}

func ParseHeader(raw []byte) (Header, error) {
	if len(raw) < HeaderSize || !bytes.Equal(raw[:8], magic[:]) || binary.LittleEndian.Uint16(raw[8:]) != WireVersion || binary.LittleEndian.Uint16(raw[10:]) != HeaderSize {
		return Header{}, fmt.Errorf("invalid state tile header")
	}
	if raw[200] != TimeScaleTDB || raw[201] != FrameEclipJ2000 || raw[202] != OriginNAIF0 || raw[203] != DistanceUnitKM || raw[204] != VelocityUnitKMS || !bytes.Equal(raw[205:208], []byte{0, 0, 0}) {
		return Header{}, fmt.Errorf("unsupported state tile scientific contract")
	}
	h := Header{Sequence: binary.LittleEndian.Uint32(raw[12:]), TileCount: binary.LittleEndian.Uint32(raw[16:]), OrdinalStart: binary.LittleEndian.Uint32(raw[20:]), RecordCount: binary.LittleEndian.Uint32(raw[24:]), Stride: binary.LittleEndian.Uint16(raw[28:]), FieldMask: binary.LittleEndian.Uint16(raw[30:]), EpochJD: math.Float64frombits(binary.LittleEndian.Uint64(raw[32:])), MetadataOffset: binary.LittleEndian.Uint32(raw[40:]), MetadataLength: binary.LittleEndian.Uint32(raw[44:]), ExactBitmapOffset: binary.LittleEndian.Uint32(raw[48:]), BitmapLength: binary.LittleEndian.Uint32(raw[52:]), ApproxBitmapOffset: binary.LittleEndian.Uint32(raw[56:]), MissingBitmapOffset: binary.LittleEndian.Uint32(raw[60:]), StatesOffset: binary.LittleEndian.Uint32(raw[64:]), StatesLength: binary.LittleEndian.Uint32(raw[68:])}
	h.TimeScaleID, h.FrameID, h.OriginID, h.DistanceUnitID, h.VelocityUnitID = raw[200], raw[201], raw[202], raw[203], raw[204]
	copy(h.PlanHash[:], raw[72:104])
	copy(h.CatalogManifestHash[:], raw[104:136])
	copy(h.InventoryManifestHash[:], raw[136:168])
	copy(h.PayloadSHA256[:], raw[168:200])
	expectedBitmapLength := (h.RecordCount + 7) / 8
	metadataEnd := uint64(h.MetadataOffset) + uint64(h.MetadataLength)
	exactEnd := uint64(h.ExactBitmapOffset) + uint64(h.BitmapLength)
	approximateEnd := uint64(h.ApproxBitmapOffset) + uint64(h.BitmapLength)
	missingEnd := uint64(h.MissingBitmapOffset) + uint64(h.BitmapLength)
	canonicalStatesOffset := (missingEnd + 7) &^ uint64(7)
	statesEnd := uint64(h.StatesOffset) + uint64(h.StatesLength)
	if h.RecordCount == 0 || h.RecordCount > MaxRows || h.TileCount == 0 || h.Sequence >= h.TileCount || h.Stride != Stride || h.FieldMask != FieldState || !finite(h.EpochJD) || h.MetadataOffset != HeaderSize || h.MetadataLength == 0 || h.BitmapLength != expectedBitmapLength || uint64(h.StatesOffset) != canonicalStatesOffset || h.StatesLength != h.RecordCount*Stride*8 || statesEnd != uint64(len(raw)) {
		return Header{}, fmt.Errorf("invalid state tile dimensions")
	}
	if metadataEnd > uint64(len(raw)) || exactEnd > uint64(len(raw)) || approximateEnd > uint64(len(raw)) || missingEnd > uint64(len(raw)) || uint64(h.ExactBitmapOffset) != metadataEnd || uint64(h.ApproxBitmapOffset) != exactEnd || uint64(h.MissingBitmapOffset) != approximateEnd {
		return Header{}, fmt.Errorf("invalid state tile offsets")
	}
	for offset := missingEnd; offset < canonicalStatesOffset; offset++ {
		if raw[int(offset)] != 0 {
			return Header{}, fmt.Errorf("nonzero state tile alignment padding")
		}
	}
	sum := sha256.Sum256(raw[HeaderSize:])
	if !bytes.Equal(sum[:], h.PayloadSHA256[:]) {
		return Header{}, fmt.Errorf("state tile payload checksum mismatch")
	}
	return h, nil
}

func HashHex(raw [32]byte) string { return hex.EncodeToString(raw[:]) }

func ParseHash(value string) ([32]byte, error) {
	var out [32]byte
	if !validHash(value) {
		return out, fmt.Errorf("invalid sha256")
	}
	b, err := hex.DecodeString(value)
	if err != nil || len(b) != len(out) {
		return out, fmt.Errorf("invalid sha256")
	}
	copy(out[:], b)
	return out, nil
}

func validHash(value string) bool {
	if len(value) != sha256.Size*2 || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func writeBitmap(dst []byte, values []bool) {
	for n, value := range values {
		if value {
			dst[n/8] |= 1 << uint(n%8)
		}
	}
}

func align8(value int) int      { return (value + 7) &^ 7 }
func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }
