// eop-audit verifies a local immutable IERS snapshot; it does not publish data.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/dajiaohuang/solar/backend/internal/earthorientation"
)

func main() {
	manifest := flag.String("manifest", "", "path to SHA-256-pinned IERS manifest")
	jd := flag.Float64("jd", 0, "optional numeric UTC Julian day to inspect")
	flag.Parse()
	table, err := earthorientation.Load(*manifest)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	report := map[string]any{"source": table.Manifest, "records": table.Count(), "coverageMjdUtc": table.CoverageMJD()}
	if *jd != 0 {
		sample, err := table.AtUTC(*jd)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		report["sample"] = sample
	}
	if err := json.NewEncoder(os.Stdout).Encode(report); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
