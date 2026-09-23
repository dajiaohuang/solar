// ground-contacts searches a local source-backed station without publishing data.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"runtime/debug"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/bodyshape"
	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
	"github.com/dajiaohuang/solar/backend/internal/observation"
)

func readBounded(path string, maximum int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maximum+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maximum {
		return nil, fmt.Errorf("input exceeds %d bytes", maximum)
	}
	return data, nil
}
func parseRequest(raw []byte) (observation.ContactRequest, error) {
	var wire struct {
		StartUTC     string `json:"startUtc"`
		EndUTC       string `json:"endUtc"`
		ForegroundID int    `json:"foregroundId"`
		BackgroundID int    `json:"backgroundId"`
		Aberration   string `json:"aberration"`
		Station      *struct {
			LongitudeDeg *float64 `json:"longitudeDeg"`
			LatitudeDeg  *float64 `json:"latitudeDeg"`
			HeightMeters *float64 `json:"heightMeters"`
		} `json:"station"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&wire); err != nil {
		return observation.ContactRequest{}, err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return observation.ContactRequest{}, fmt.Errorf("expected exactly one request")
	}
	if wire.Station == nil || wire.Station.LongitudeDeg == nil || wire.Station.LatitudeDeg == nil || wire.Station.HeightMeters == nil {
		return observation.ContactRequest{}, fmt.Errorf("explicit station longitude, latitude and ellipsoidal height are required")
	}
	return observation.ContactRequest{StartUTC: wire.StartUTC, EndUTC: wire.EndUTC, ForegroundID: wire.ForegroundID, BackgroundID: wire.BackgroundID, Aberration: wire.Aberration,
		Station: observation.Station{LongitudeDeg: *wire.Station.LongitudeDeg, LatitudeDeg: *wire.Station.LatitudeDeg, HeightMeters: *wire.Station.HeightMeters}}, nil
}
func run() error {
	dataDir := flag.String("data-dir", "", "local SPK catalog directory")
	iers := flag.String("iers", "", "pinned IERS manifest path")
	pck := flag.String("pck", "", "original pck00011.tpc path")
	input := flag.String("input", "", "contact request JSON, at most 64 KiB")
	output := flag.String("output", "", "new receipt JSON path; never overwritten")
	flag.Parse()
	if *dataDir == "" || *iers == "" || *pck == "" || *input == "" || *output == "" || flag.NArg() != 0 {
		return fmt.Errorf("--data-dir, --iers, --pck, --input and --output are required")
	}
	raw, err := readBounded(*input, 65536)
	if err != nil {
		return err
	}
	req, err := parseRequest(raw)
	if err != nil {
		return err
	}
	pckRaw, err := readBounded(*pck, bodyshape.Bytes)
	if err != nil {
		return err
	}
	shapes, err := bodyshape.Parse(pckRaw)
	if err != nil {
		return err
	}
	eop, err := earthorientation.Load(*iers)
	if err != nil {
		return err
	}
	cat, err := catalog.Load(*dataDir)
	if err != nil {
		return err
	}
	defer cat.Close()
	interrupt, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	ctx, cancel := context.WithTimeout(interrupt, 20*time.Second)
	defer cancel()
	result, err := observation.SearchGroundContacts(ctx, req, shapes, eop, cat.EvalBatchContext)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(raw)
	build, _ := debug.ReadBuildInfo()
	encoded, err := json.MarshalIndent(map[string]any{"schemaVersion": 1, "inputFile": map[string]any{"sha256": hex.EncodeToString(digest[:]), "bytes": len(raw), "payload": req},
		"catalogVersion": cat.Version(), "catalogManifestSha256": cat.ManifestHash(), "build": build, "result": result}, "", "  ")
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	f, err := os.OpenFile(*output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, writeErr := f.Write(append(encoded, '\n'))
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	fmt.Printf("%s: %d contacts; %d geometry evaluations; sampled coverage only\n", *output, len(result.Contacts), result.Evaluations)
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
