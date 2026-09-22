// Package earthorientation reads source-pinned IERS finals2000A records.
// Time conversion uses GoFA, derived from IAU SOFA; Solar Atlas is not software
// provided or endorsed by SOFA. See THIRD_PARTY_NOTICES.md.
package earthorientation

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hebl/gofa"
)

const SourceURL = "https://data.iers.org/products/eop/rapid/standard/finals2000A.all"
const maxSourceBytes = 8 << 20

type Entry struct {
	MJD       float64  `json:"mjdUtc"`
	XP        float64  `json:"xpArcsec"`
	YP        float64  `json:"ypArcsec"`
	DUT1      float64  `json:"ut1MinusUtcSeconds"`
	XPError   float64  `json:"xpErrorArcsec"`
	YPError   float64  `json:"ypErrorArcsec"`
	DUT1Error float64  `json:"ut1ErrorSeconds"`
	DX        *float64 `json:"dXMas"`
	DY        *float64 `json:"dYMas"`
	DXError   *float64 `json:"dXErrorMas"`
	DYError   *float64 `json:"dYErrorMas"`
	PoleFlag  string   `json:"poleFlag"`
	UT1Flag   string   `json:"ut1Flag"`
	CPOFlag   string   `json:"cpoFlag"`
}

type Manifest struct {
	SchemaVersion int    `json:"schemaVersion"`
	SourceURL     string `json:"sourceUrl"`
	RetrievedAt   string `json:"retrievedAt"`
	SHA256        string `json:"sha256"`
	Bytes         int    `json:"bytes"`
	Path          string `json:"path"`
}

type Table struct {
	Manifest Manifest
	entries  []Entry
}

type Sample struct {
	Entry
	BracketMJD   [2]float64 `json:"bracketMjdUtc"`
	Predicted    bool       `json:"predicted"`
	CPOAvailable bool       `json:"celestialPoleCorrectionAvailable"`
	SourceSHA256 string     `json:"sourceSha256"`
	RetrievedAt  string     `json:"retrievedAt"`
}

// ParseFinals2000A consumes Bulletin A columns, including their published errors
// and I/P flags. Bulletin B columns are not silently mixed with Bulletin A.
// Format: https://maia.usno.navy.mil/ser7/readme.finals2000A
func ParseFinals2000A(reader io.Reader) ([]Entry, error) {
	scanner := bufio.NewScanner(io.LimitReader(reader, maxSourceBytes+1))
	scanner.Buffer(make([]byte, 256), 1024)
	var entries []Entry
	total, line := 0, 0
	for scanner.Scan() {
		text := scanner.Text()
		line++
		total += len(text) + 1
		if total > maxSourceBytes {
			return nil, fmt.Errorf("IERS source exceeds byte limit")
		}
		if strings.TrimSpace(text) == "" {
			continue
		}
		fail := func() error { return fmt.Errorf("invalid IERS finals2000A record at line %d", line) }
		if len(text) < 78 {
			return nil, fail()
		}
		field := func(start, end int) string {
			if len(text) < end {
				return ""
			}
			return strings.TrimSpace(text[start:end])
		}
		number := func(start, end int) (float64, error) {
			value, err := strconv.ParseFloat(field(start, end), 64)
			if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
				return 0, fail()
			}
			return value, nil
		}
		mjd, err := number(7, 15)
		if err != nil || mjd < 40000 || mjd > 100000 || mjd != math.Trunc(mjd) {
			return nil, fail()
		}
		var year, month, day int
		var fraction float64
		if gofa.Jd2cal(gofa.DJM0, mjd, &year, &month, &day, &fraction) != 0 {
			return nil, fail()
		}
		for _, calendar := range []struct{ start, end, want int }{{0, 2, year % 100}, {2, 4, month}, {4, 6, day}} {
			value, err := strconv.Atoi(field(calendar.start, calendar.end))
			if err != nil || value != calendar.want {
				return nil, fail()
			}
		}
		// The official file has dated placeholders beyond its prediction span.
		if field(16, 17) == "" && field(57, 58) == "" && field(18, 78) == "" {
			continue
		}
		entry := Entry{MJD: mjd, PoleFlag: field(16, 17), UT1Flag: field(57, 58), CPOFlag: field(95, 96)}
		validFlag := func(flag string) bool { return flag == "I" || flag == "P" }
		if !validFlag(entry.PoleFlag) || !validFlag(entry.UT1Flag) {
			return nil, fail()
		}
		for _, part := range []struct {
			start, end int
			dst        *float64
		}{
			{18, 27, &entry.XP}, {37, 46, &entry.YP}, {58, 68, &entry.DUT1},
			{27, 36, &entry.XPError}, {46, 55, &entry.YPError}, {68, 78, &entry.DUT1Error},
		} {
			value, parseErr := number(part.start, part.end)
			if parseErr != nil {
				return nil, parseErr
			}
			*part.dst = value
		}
		if math.Abs(entry.XP) > 5 || math.Abs(entry.YP) > 5 || math.Abs(entry.DUT1) > 2 || entry.XPError < 0 || entry.YPError < 0 || entry.DUT1Error < 0 {
			return nil, fail()
		}
		if field(97, 106) != "" || field(116, 125) != "" {
			dx, ex := number(97, 106)
			dy, ey := number(116, 125)
			dxe, exe := number(106, 115)
			dye, eye := number(125, 134)
			if ex != nil || ey != nil || exe != nil || eye != nil || dxe < 0 || dye < 0 || !validFlag(entry.CPOFlag) || math.Abs(dx) > 100 || math.Abs(dy) > 100 {
				return nil, fail()
			}
			entry.DX, entry.DY = &dx, &dy
			entry.DXError, entry.DYError = &dxe, &dye
		} else if entry.CPOFlag != "" {
			return nil, fail()
		}
		if len(entries) > 0 && entry.MJD <= entries[len(entries)-1].MJD {
			return nil, fmt.Errorf("IERS dates are not strictly increasing at line %d", line)
		}
		entries = append(entries, entry)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(entries) < 2 {
		return nil, fmt.Errorf("IERS source requires at least two complete epochs")
	}
	return entries, nil
}

func Load(manifestPath string) (*Table, error) {
	manifestFile, err := os.Open(manifestPath)
	if err != nil {
		return nil, err
	}
	defer manifestFile.Close()
	rawManifest, err := io.ReadAll(io.LimitReader(manifestFile, 16385))
	if err != nil {
		return nil, err
	}
	if len(rawManifest) > 16384 {
		return nil, fmt.Errorf("IERS manifest exceeds byte limit")
	}
	var manifest Manifest
	if err := json.Unmarshal(rawManifest, &manifest); err != nil {
		return nil, err
	}
	stamp, err := time.Parse(time.RFC3339, manifest.RetrievedAt)
	digest, hashErr := hex.DecodeString(manifest.SHA256)
	if manifest.SchemaVersion != 1 || manifest.SourceURL != SourceURL || err != nil || stamp.After(time.Now().Add(5*time.Minute)) || hashErr != nil || len(digest) != sha256.Size || manifest.SHA256 != strings.ToLower(manifest.SHA256) || manifest.Bytes < 1 || manifest.Bytes > maxSourceBytes || manifest.Path != "finals2000A-"+manifest.SHA256+".all" {
		return nil, fmt.Errorf("invalid IERS source manifest")
	}
	file, err := os.Open(filepath.Join(filepath.Dir(manifestPath), manifest.Path))
	if err != nil {
		return nil, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, int64(manifest.Bytes)+1))
	if err != nil {
		return nil, err
	}
	actual := sha256.Sum256(raw)
	if len(raw) != manifest.Bytes || hex.EncodeToString(actual[:]) != manifest.SHA256 {
		return nil, fmt.Errorf("IERS source size or SHA-256 mismatch")
	}
	entries, err := ParseFinals2000A(strings.NewReader(string(raw)))
	if err != nil {
		return nil, err
	}
	return &Table{Manifest: manifest, entries: entries}, nil
}

func (t *Table) CoverageMJD() [2]float64 {
	return [2]float64{t.entries[0].MJD, t.entries[len(t.entries)-1].MJD}
}
func (t *Table) Count() int { return len(t.entries) }

func leapSeconds(mjd float64) (float64, error) {
	var year, month, day int
	var fraction, seconds float64
	if gofa.Jd2cal(gofa.DJM0, mjd, &year, &month, &day, &fraction) != 0 || gofa.Dat(year, month, day, fraction, &seconds) < 0 {
		return 0, fmt.Errorf("unsupported IERS epoch")
	}
	return seconds, nil
}

// AtUTC interpolates UT1-TAI, not the discontinuous UT1-UTC. This preserves the
// published leap-second jump. There is no extrapolation through gaps or beyond
// the file's available observations/predictions. Published sigma values use the
// larger endpoint value; they are not a propagated confidence interval.
func (t *Table) AtUTC(jd float64) (Sample, error) {
	mjd := jd - gofa.DJM0
	if math.IsNaN(mjd) || math.IsInf(mjd, 0) || len(t.entries) < 2 || mjd < t.entries[0].MJD || mjd > t.entries[len(t.entries)-1].MJD {
		return Sample{}, fmt.Errorf("UTC epoch is outside the available IERS EOP coverage")
	}
	index := sort.Search(len(t.entries), func(i int) bool { return t.entries[i].MJD >= mjd })
	right := t.entries[index]
	left := right
	if right.MJD != mjd {
		left = t.entries[index-1]
	}
	if right.MJD-left.MJD > 1.01 {
		return Sample{}, fmt.Errorf("IERS EOP coverage has a gap at UTC JD %.9f", jd)
	}
	u := 0.0
	if right.MJD > left.MJD {
		u = (mjd - left.MJD) / (right.MJD - left.MJD)
	}
	blend := func(a, b float64) float64 { return a + (b-a)*u }
	leapL, err := leapSeconds(left.MJD)
	if err != nil {
		return Sample{}, err
	}
	leapR, err := leapSeconds(right.MJD)
	if err != nil {
		return Sample{}, err
	}
	leapNow, err := leapSeconds(mjd)
	if err != nil {
		return Sample{}, err
	}
	entry := left
	entry.MJD, entry.XP, entry.YP = mjd, blend(left.XP, right.XP), blend(left.YP, right.YP)
	if u == 0 {
		entry.DUT1 = left.DUT1
	} else {
		entry.DUT1 = blend(left.DUT1-leapL, right.DUT1-leapR) + leapNow
	}
	entry.XPError, entry.YPError, entry.DUT1Error = math.Max(left.XPError, right.XPError), math.Max(left.YPError, right.YPError), math.Max(left.DUT1Error, right.DUT1Error)
	if right.PoleFlag == "P" {
		entry.PoleFlag = "P"
	}
	if right.UT1Flag == "P" {
		entry.UT1Flag = "P"
	}
	if right.CPOFlag == "P" {
		entry.CPOFlag = "P"
	}
	entry.DX, entry.DY = nil, nil
	entry.DXError, entry.DYError = nil, nil
	if left.DX != nil && left.DY != nil && right.DX != nil && right.DY != nil {
		dx, dy := blend(*left.DX, *right.DX), blend(*left.DY, *right.DY)
		entry.DX, entry.DY = &dx, &dy
		if left.DXError != nil && left.DYError != nil && right.DXError != nil && right.DYError != nil {
			dxe, dye := math.Max(*left.DXError, *right.DXError), math.Max(*left.DYError, *right.DYError)
			entry.DXError, entry.DYError = &dxe, &dye
		}
	} else {
		entry.CPOFlag = ""
	}
	return Sample{Entry: entry, BracketMJD: [2]float64{left.MJD, right.MJD}, Predicted: entry.PoleFlag == "P" || entry.UT1Flag == "P" || entry.CPOFlag == "P", CPOAvailable: entry.DX != nil, SourceSHA256: t.Manifest.SHA256, RetrievedAt: t.Manifest.RetrievedAt}, nil
}
