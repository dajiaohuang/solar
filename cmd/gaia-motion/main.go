// gaia-motion evaluates one original Gaia CSV row without publishing data.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"runtime/debug"

	"github.com/dajiaohuang/solar/backend/internal/stellarmotion"
)

func readBounded(path string, maximum int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	bytes, err := io.ReadAll(io.LimitReader(f, maximum+1))
	if err != nil {
		return nil, err
	}
	if int64(len(bytes)) > maximum {
		return nil, fmt.Errorf("input byte budget exceeded")
	}
	return bytes, nil
}
func run() error {
	manifest := flag.String("manifest", "", "Gaia capture manifest, at most 1 MiB")
	rows := flag.String("rows", "", "original rows.csv, at most 8 MiB")
	id := flag.String("source-id", "", "exact decimal Gaia source ID")
	epoch := flag.Float64("epoch-tcb", 0, "target Julian year in TCB")
	policy := flag.String("rv-policy", "", "explicit spectroscopic-as-astrometric approximation")
	covariancePolicy := flag.String("covariance-policy", "", "optional independent-spectroscopic-rv formal uncertainty assumption")
	output := flag.String("output", "", "new receipt JSON path, never overwritten")
	flag.Parse()
	if *manifest == "" || *rows == "" || *id == "" || *output == "" || flag.NArg() != 0 {
		return fmt.Errorf("--manifest --rows --source-id --epoch-tcb --rv-policy --output are required")
	}
	m, err := readBounded(*manifest, 1<<20)
	if err != nil {
		return err
	}
	r, err := readBounded(*rows, 8<<20)
	if err != nil {
		return err
	}
	receipt, err := stellarmotion.FromCSVWithCovariance(context.Background(), m, r, *id, *epoch, *policy, *covariancePolicy)
	if err != nil {
		return err
	}
	build, _ := debug.ReadBuildInfo()
	bytes, err := json.MarshalIndent(map[string]any{"build": build, "experiment": receipt}, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.OpenFile(*output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, writeErr := f.Write(append(bytes, '\n'))
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	fmt.Printf("%s: source %s at J%.9f TCB; formal covariance included: %t; physical accuracy is not certified\n", *output, *id, *epoch, receipt.FormalCovariance != nil)
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
