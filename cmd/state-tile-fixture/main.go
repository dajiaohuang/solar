// Command state-tile-fixture produces small, cross-runtime state-tile golden
// fixtures from the real catalog and HTTP handlers. It never overwrites an
// existing output file or checks generated binary data into the repository.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/httpapi"
	"github.com/dajiaohuang/solar/backend/internal/inventory"
	"github.com/dajiaohuang/solar/backend/internal/statewire"
)

type planFile struct {
	APIVersion              string  `json:"apiVersion"`
	PlanID                  string  `json:"planId"`
	EpochJD                 float64 `json:"epochJd"`
	CatalogManifestSHA256   string  `json:"catalogManifestSha256"`
	InventoryManifestSHA256 string  `json:"inventoryManifestSha256,omitempty"`
	BodyCount               int     `json:"bodyCount"`
	TileCount               int     `json:"tileCount"`
	ExactCount              int     `json:"exactCount"`
	ApproximateCount        int     `json:"approximateCount"`
	MissingCount            int     `json:"missingCount"`
	Tiles                   []struct {
		Sequence     uint32 `json:"sequence"`
		OrdinalStart uint32 `json:"ordinalStart"`
		OrdinalCount uint32 `json:"ordinalCount"`
	} `json:"tiles"`
}

type metadataRow struct {
	ID string `json:"id"`
}

type expectedRow struct {
	ID                 string   `json:"id"`
	Status             string   `json:"status"`
	StateIEEE754BitsLE []string `json:"stateIEEE754BitsLE"`
}

type tileFile struct {
	Sequence      uint32        `json:"sequence"`
	File          string        `json:"file"`
	Bytes         int           `json:"bytes"`
	SHA256        string        `json:"sha256"`
	PayloadSHA256 string        `json:"payloadSha256"`
	OrdinalStart  uint32        `json:"ordinalStart"`
	RecordCount   uint32        `json:"recordCount"`
	ExpectedRows  []expectedRow `json:"expectedRows"`
}

type fixtureManifest struct {
	Format                  string     `json:"format"`
	FixtureSource           string     `json:"fixtureSource"`
	APIVersion              string     `json:"apiVersion"`
	EpochJD                 float64    `json:"epochJd"`
	IDs                     []string   `json:"ids"`
	CatalogManifestSHA256   string     `json:"catalogManifestSha256"`
	InventoryManifestSHA256 string     `json:"inventoryManifestSha256,omitempty"`
	CatalogManifestFile     string     `json:"catalogManifestFile"`
	PlanFile                string     `json:"planFile"`
	Plan                    planFile   `json:"plan"`
	Tiles                   []tileFile `json:"tiles"`
}

func main() {
	out := flag.String("out", "", "new or empty output directory")
	dataDir := flag.String("data-dir", "", "optional real ephemeris data directory; omit for synthetic fixture")
	inventoryDir := flag.String("inventory-dir", "", "optional real addressable inventory directory")
	spkPath := flag.String("synthetic-spk", "tests/fixtures/spk21-synthetic.bsp", "synthetic SPK used when -data-dir is omitted")
	idsFlag := flag.String("ids", "", "comma-separated IDs; defaults to an exact+missing synthetic or audit set")
	epochFlag := flag.Float64("epoch-jd", 0, "TDB epoch; defaults to 2451545 for synthetic and 2461287.5 for real data")
	tileSize := flag.Int("tile-size", 2, "rows per binary tile")
	flag.Parse()
	if *out == "" {
		fatalf("-out is required")
	}
	if *tileSize < 1 || *tileSize > statewire.MaxRows {
		fatalf("tile-size must be between 1 and %d", statewire.MaxRows)
	}
	if err := prepareOutput(*out); err != nil {
		fatalf("prepare output: %v", err)
	}

	synthetic := strings.TrimSpace(*dataDir) == ""
	epochJD := *epochFlag
	if epochJD == 0 {
		if synthetic {
			epochJD = 2451545
		} else {
			epochJD = 2461287.5
		}
	}
	ids := splitIDs(*idsFlag)
	if len(ids) == 0 {
		if synthetic {
			ids = []string{"naif:-210001", "unknown:fixture"}
		} else {
			ids = []string{"earth", "naif:10", "unknown:fixture"}
		}
	}

	loadedDir := *dataDir
	cleanup := func() {}
	if synthetic {
		var err error
		loadedDir, cleanup, err = makeSyntheticData(*spkPath)
		if err != nil {
			fatalf("prepare synthetic data: %v", err)
		}
	}
	defer cleanup()
	c, err := catalog.Load(loadedDir)
	if err != nil {
		fatalf("load catalog: %v", err)
	}
	defer c.Close()
	var inv *inventory.Inventory
	if *inventoryDir != "" {
		inv, err = inventory.Load(*inventoryDir)
		if err != nil {
			fatalf("load inventory: %v", err)
		}
	}

	server := httpapi.New(c, 2, inv)
	catalogRaw, catalogResponse := serveWithResponse(server, http.MethodGet, "/v1/catalog/manifest", nil)
	if catalogResponse.Code != http.StatusOK {
		fatalf("catalog manifest status=%d body=%s", catalogResponse.Code, catalogResponse.Body.String())
	}
	var catalogEnvelope struct {
		CatalogManifestSHA256 string `json:"catalogManifestSha256"`
	}
	if err := json.Unmarshal(catalogRaw, &catalogEnvelope); err != nil || catalogEnvelope.CatalogManifestSHA256 == "" {
		fatalf("parse catalog manifest: %v", err)
	}
	if err := writeNew(filepath.Join(*out, "catalog-manifest.json"), catalogRaw); err != nil {
		fatalf("write catalog manifest: %v", err)
	}
	planBody, _ := json.Marshal(map[string]any{"ids": ids, "epochJd": epochJD, "timeScale": "TDB", "frame": "ECLIPJ2000", "precision": "exact", "fieldMask": []string{"position", "velocity"}, "tileSize": *tileSize})
	planRaw, planResponse := serveWithResponse(server, http.MethodPost, "/v1/state/plan", planBody)
	if planResponse.Code != http.StatusOK {
		fatalf("plan status=%d body=%s", planResponse.Code, planResponse.Body.String())
	}
	var plan planFile
	if err := json.Unmarshal(planRaw, &plan); err != nil || plan.PlanID == "" {
		fatalf("parse plan: %v", err)
	}
	if plan.CatalogManifestSHA256 != catalogEnvelope.CatalogManifestSHA256 {
		fatalf("catalog manifest hash changed between endpoints: %s != %s", catalogEnvelope.CatalogManifestSHA256, plan.CatalogManifestSHA256)
	}
	if err := writeNew(filepath.Join(*out, "plan.json"), planRaw); err != nil {
		fatalf("write plan: %v", err)
	}

	fixtureSource := "real-httpapi"
	if synthetic {
		fixtureSource = "real-httpapi; synthetic SPK fixture (test provenance, not a scientific oracle)"
	}
	manifest := fixtureManifest{Format: "solar.state-tile-fixture/v1", FixtureSource: fixtureSource, APIVersion: plan.APIVersion, EpochJD: epochJD, IDs: ids, CatalogManifestSHA256: plan.CatalogManifestSHA256, InventoryManifestSHA256: plan.InventoryManifestSHA256, CatalogManifestFile: "catalog-manifest.json", PlanFile: "plan.json", Plan: plan}
	for _, descriptor := range plan.Tiles {
		body, response := serveWithResponse(server, http.MethodPost, "/v1/state/tiles", []byte(`{"planId":"`+plan.PlanID+`","sequence":`+strconv.FormatUint(uint64(descriptor.Sequence), 10)+`}`))
		if response.Code != http.StatusOK {
			fatalf("tile %d status=%d body=%s", descriptor.Sequence, response.Code, response.Body.String())
		}
		name := fmt.Sprintf("tile-%d.bin", descriptor.Sequence)
		if err := writeNew(filepath.Join(*out, name), body); err != nil {
			fatalf("write %s: %v", name, err)
		}
		tile, err := describeTile(body)
		if err != nil {
			fatalf("describe tile %d: %v", descriptor.Sequence, err)
		}
		tile.Sequence, tile.File = descriptor.Sequence, name
		manifest.Tiles = append(manifest.Tiles, tile)
	}
	encoded, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		fatalf("encode manifest: %v", err)
	}
	encoded = append(encoded, '\n')
	if err := writeNew(filepath.Join(*out, "manifest.json"), encoded); err != nil {
		fatalf("write manifest: %v", err)
	}
}

func serveWithResponse(server http.Handler, method, path string, body []byte) ([]byte, *httptest.ResponseRecorder) {
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(method, path, bytes.NewReader(body)))
	return response.Body.Bytes(), response
}

func describeTile(raw []byte) (tileFile, error) {
	header, err := statewire.ParseHeader(raw)
	if err != nil {
		return tileFile{}, err
	}
	metadataBytes := raw[header.MetadataOffset : header.MetadataOffset+header.MetadataLength]
	lines := bytes.Split(bytes.TrimSuffix(metadataBytes, []byte{'\n'}), []byte{'\n'})
	rows := make([]expectedRow, header.RecordCount)
	for n := range rows {
		var metadata metadataRow
		if n >= len(lines) || json.Unmarshal(lines[n], &metadata) != nil {
			return tileFile{}, fmt.Errorf("metadata row %d is invalid", n)
		}
		status := "missing"
		if raw[header.ExactBitmapOffset+uint32(n/8)]&(1<<uint(n%8)) != 0 {
			status = "exact"
		}
		if raw[header.ApproxBitmapOffset+uint32(n/8)]&(1<<uint(n%8)) != 0 {
			status = "approximate"
		}
		bits := make([]string, header.Stride)
		for component := range bits {
			value := binary.LittleEndian.Uint64(raw[header.StatesOffset+(uint32(n)*uint32(header.Stride)+uint32(component))*8:])
			bits[component] = fmt.Sprintf("%016x", value)
		}
		rows[n] = expectedRow{ID: metadata.ID, Status: status, StateIEEE754BitsLE: bits}
	}
	payloadHash := hex.EncodeToString(header.PayloadSHA256[:])
	wholeHash := sha256.Sum256(raw)
	return tileFile{Bytes: len(raw), SHA256: hex.EncodeToString(wholeHash[:]), PayloadSHA256: payloadHash, OrdinalStart: header.OrdinalStart, RecordCount: header.RecordCount, ExpectedRows: rows}, nil
}

func makeSyntheticData(source string) (string, func(), error) {
	raw, err := os.ReadFile(source)
	if err != nil {
		return "", func() {}, err
	}
	dir, err := os.MkdirTemp("", "solar-state-tile-fixture-")
	if err != nil {
		return "", func() {}, err
	}
	cleanup := func() { _ = os.RemoveAll(dir) }
	if err := os.WriteFile(filepath.Join(dir, "synthetic.bsp"), raw, 0600); err != nil {
		cleanup()
		return "", func() {}, err
	}
	sum := sha256.Sum256(raw)
	manifest := fmt.Sprintf(`{"id":"synthetic-state-tile-v1","profile":"fixture","contract":"Original SPK types 2/3/17/21","files":[{"id":"synthetic","path":"synthetic.bsp","targets":[-210001],"startEt":0,"endEt":1000,"solutionKernelIds":["synthetic"],"bytes":%d,"sha256":"%s"}]}`, len(raw), hex.EncodeToString(sum[:]))
	if err := os.WriteFile(filepath.Join(dir, "ephemeris-manifest.json"), []byte(manifest), 0600); err != nil {
		cleanup()
		return "", func() {}, err
	}
	return dir, cleanup, nil
}

func prepareOutput(path string) error {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return os.MkdirAll(path, 0700)
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("output is not a directory")
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return err
	}
	if len(entries) != 0 {
		return fmt.Errorf("output directory is not empty")
	}
	return nil
}

func writeNew(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(data)
	return err
}

func splitIDs(value string) []string {
	var ids []string
	seen := make(map[string]struct{})
	for _, part := range strings.Split(value, ",") {
		id := strings.TrimSpace(part)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

func fatalf(format string, args ...any) {
	_, _ = fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
