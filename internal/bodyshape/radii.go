// Package bodyshape retains the original, pinned NAIF PCK semiaxes.
package bodyshape

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const SHA256 = "3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1"
const Bytes = 131226
const SourceURL = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc"

type Radii struct {
	NAIFPCKID      int        `json:"naifPckId"`
	RadiiKM        [3]float64 `json:"radiiKm"`
	Representation string     `json:"representation"`
	UncertaintyKM  *float64   `json:"uncertaintyKm"`
}
type Table struct{ bodies map[int]Radii }

// Load bounds disk reads before source validation; configuration failures must
// prevent a configured service from starting with an implicit replacement.
func Load(path string) (*Table, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, Bytes+1))
	if err != nil {
		return nil, err
	}
	return Parse(raw)
}

// Get returns a value copy. PCK IDs are not silently aliased to SPK IDs.
func (t *Table) Get(id int) (Radii, bool) {
	if t == nil {
		return Radii{}, false
	}
	r, ok := t.bodies[id]
	return r, ok
}
func (t *Table) Count() int { return len(t.bodies) }

var assignment = regexp.MustCompile(`\bBODY(\d+)_RADII\s*=\s*\(([^)]*)\)`)

// Parse only accepts the pinned source, not arbitrary PCK syntax or overrides.
func Parse(raw []byte) (*Table, error) {
	if len(raw) != Bytes {
		return nil, fmt.Errorf("PCK source size mismatch")
	}
	data := append([]byte(nil), raw...)
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != SHA256 {
		return nil, fmt.Errorf("PCK source checksum mismatch")
	}
	var blocks strings.Builder
	active := false
	for _, line := range strings.Split(string(data), "\n") {
		switch strings.TrimSpace(line) {
		case `\begindata`:
			active = true
		case `\begintext`:
			active = false
		default:
			if active {
				blocks.WriteString(line)
				blocks.WriteByte('\n')
			}
		}
	}
	t := &Table{bodies: map[int]Radii{}}
	for _, match := range assignment.FindAllStringSubmatch(blocks.String(), -1) {
		id, err := strconv.Atoi(match[1])
		if err != nil {
			return nil, err
		}
		fields := strings.Fields(match[2])
		if _, exists := t.bodies[id]; exists || len(fields) != 3 {
			return nil, fmt.Errorf("invalid PCK assignment")
		}
		r := Radii{NAIFPCKID: id, Representation: "sphere"}
		for i, field := range fields {
			v, err := strconv.ParseFloat(strings.NewReplacer("D", "E", "d", "E").Replace(field), 64)
			if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
				return nil, fmt.Errorf("invalid PCK radius")
			}
			r.RadiiKM[i] = v
			if i > 0 && v != r.RadiiKM[0] {
				r.Representation = "triaxial-ellipsoid"
			}
		}
		t.bodies[id] = r
	}
	if len(t.bodies) == 0 {
		return nil, fmt.Errorf("PCK contains no radii")
	}
	return t, nil
}
