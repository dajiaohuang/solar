// Command window-bench compares sequential HTTP plan/tile delivery with one
// streaming time-grid request against exactly the same immutable profile.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/httpapi"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sort"
	"strconv"
	"sync/atomic"
	"time"
)

type evidence struct {
	Mode      string            `json:"mode"`
	Requests  int64             `json:"requests"`
	BodyCount int               `json:"uniqueNaifTargets"`
	Samples   int               `json:"samples"`
	Exact     int               `json:"exactBodyEpochs"`
	Missing   int               `json:"missingBodyEpochs"`
	FirstMs   float64           `json:"firstVerifiedTileMs"`
	TotalMs   float64           `json:"totalMs"`
	Bytes     int               `json:"responseBytes"`
	Digest    string            `json:"orderedTileBytesSha256"`
	Cache     map[string]uint64 `json:"evaluationCache"`
	Compute   map[string]uint64 `json:"compute"`
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func post(client *http.Client, url string, body any) *http.Response {
	raw, err := json.Marshal(body)
	must(err)
	response, err := client.Post(url, "application/json", bytes.NewReader(raw))
	must(err)
	if response.StatusCode != 200 {
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		panic(fmt.Sprintf("HTTP %d: %s", response.StatusCode, body))
	}
	return response
}
func frame(r io.Reader) []byte {
	var size [4]byte
	_, err := io.ReadFull(r, size[:])
	must(err)
	n := binary.LittleEndian.Uint32(size[:])
	if n > 64<<20 {
		panic("unbounded frame")
	}
	raw := make([]byte, n)
	_, err = io.ReadFull(r, raw)
	must(err)
	return raw
}

type plan struct {
	PlanID       string `json:"planId"`
	TileCount    int    `json:"tileCount"`
	ExactCount   int    `json:"exactCount"`
	MissingCount int    `json:"missingCount"`
}

func run(dir, mode string, samples int) (evidence, string) {
	cat, err := catalog.Load(dir)
	must(err)
	defer cat.Close()
	seen := map[int]bool{}
	ids := []string{}
	for _, body := range cat.Page("", 0, cat.Len()) {
		if body.Availability == catalog.AvailableOperational && body.NAIFID != 0 && !seen[body.NAIFID] {
			seen[body.NAIFID] = true
			ids = append(ids, "naif:"+strconv.Itoa(body.NAIFID))
		}
	}
	sort.Strings(ids)
	if len(ids) == 0 || len(ids) > 1024 {
		panic("benchmark requires 1..1024 unique operational NAIF targets")
	}
	backend := httpapi.New(cat, 8)
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); backend.ServeHTTP(w, r) }))
	defer server.Close()
	epochs := make([]float64, samples)
	for n := range epochs {
		epochs[n] = 2461287.5 + float64(n)/24
	}
	out := evidence{Mode: mode, BodyCount: len(ids), Samples: samples}
	digest := sha256.New()
	start := time.Now()
	consume := func(raw []byte) {
		// Compare byte-identical complete tiles including source/epoch hashes,
		// status bitmaps and the original Float64 payloads between both modes.
		if len(raw) < 200 {
			panic("truncated tile")
		}
		sum := sha256.Sum256(raw[200:])
		if !bytes.Equal(sum[:], raw[168:200]) {
			panic("tile checksum mismatch")
		}
		digest.Write(raw)
		out.Bytes += len(raw)
		if out.FirstMs == 0 {
			out.FirstMs = float64(time.Since(start)) / float64(time.Millisecond)
		}
	}
	if mode == "sequential-plan-tile" {
		for _, epoch := range epochs {
			response := post(server.Client(), server.URL+"/v1/state/plan", map[string]any{"ids": ids, "epochJd": epoch, "tileSize": 1024, "fieldMask": []string{"position", "velocity"}})
			raw, err := io.ReadAll(response.Body)
			response.Body.Close()
			must(err)
			out.Bytes += len(raw)
			var p plan
			must(json.Unmarshal(raw, &p))
			out.Exact += p.ExactCount
			out.Missing += p.MissingCount
			for sequence := 0; sequence < p.TileCount; sequence++ {
				response := post(server.Client(), server.URL+"/v1/state/tiles", map[string]any{"planId": p.PlanID, "sequence": sequence})
				raw, err := io.ReadAll(response.Body)
				response.Body.Close()
				must(err)
				consume(raw)
			}
		}
	} else {
		response := post(server.Client(), server.URL+"/v1/state/window", map[string]any{"ids": ids, "epochsJd": epochs, "fieldMask": []string{"position", "velocity"}})
		defer response.Body.Close()
		out.Bytes += len(frame(response.Body)) + 4
		for n := range epochs {
			raw := frame(response.Body)
			out.Bytes += len(raw) + 4
			var entry struct {
				Kind       string
				EpochIndex int
				Plan       plan
			}
			must(json.Unmarshal(raw, &entry))
			if entry.Kind != "epoch" || entry.EpochIndex != n {
				panic("invalid epoch envelope")
			}
			out.Exact += entry.Plan.ExactCount
			out.Missing += entry.Plan.MissingCount
			for sequence := 0; sequence < entry.Plan.TileCount; sequence++ {
				consume(frame(response.Body))
				out.Bytes += 4
			}
		}
		raw := frame(response.Body)
		out.Bytes += len(raw) + 4
		var summary struct {
			Kind                     string
			ExactCount, MissingCount int
		}
		must(json.Unmarshal(raw, &summary))
		if summary.Kind != "complete" || summary.ExactCount != out.Exact || summary.MissingCount != out.Missing {
			panic("invalid completion")
		}
		tail, err := io.ReadAll(response.Body)
		must(err)
		if len(tail) != 0 {
			panic("trailing bytes")
		}
	}
	out.TotalMs = float64(time.Since(start)) / float64(time.Millisecond)
	out.Requests = requests.Load()
	out.Digest = fmt.Sprintf("%x", digest.Sum(nil))
	out.Cache = cat.EvaluationCacheStats()
	out.Compute = backend.ComputeStats()
	return out, cat.ManifestHash()
}

func main() {
	dir := flag.String("data-dir", "src/data", "staged immutable backend profile")
	samples := flag.Int("samples", 24, "strictly increasing hourly TDB samples")
	output := flag.String("output", "", "optional JSON report path")
	flag.Parse()
	if *samples < 1 || *samples > 240 {
		panic("samples must be 1..240")
	}
	baseline, hash := run(*dir, "sequential-plan-tile", *samples)
	stream, otherHash := run(*dir, "streaming-window", *samples)
	if hash != otherHash || baseline.Digest != stream.Digest || baseline.Exact != stream.Exact || baseline.Missing != stream.Missing {
		panic("scientific parity failed")
	}
	raw, err := json.MarshalIndent(map[string]any{"catalogManifestSha256": hash, "goVersion": runtime.Version(), "gomaxprocs": runtime.GOMAXPROCS(0), "platform": runtime.GOOS + "/" + runtime.GOARCH, "boundary": "Loopback HTTP; new Catalog per mode; OS file cache uncontrolled. Unique NAIF targets, not a census of physical bodies. First tile includes integrity verification; no real-device or production claim.", "results": []evidence{baseline, stream}}, "", "  ")
	must(err)
	if *output != "" {
		must(os.WriteFile(*output, raw, 0600))
	}
	fmt.Println(string(raw))
}
