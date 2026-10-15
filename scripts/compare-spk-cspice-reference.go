// Compare Solar's Go SPK reader and explicit source-chain evaluation with an
// independently generated CSPICE reference report.
//
// Usage:
//
//	rtk proxy go run scripts/compare-spk-cspice-reference.go PACK CSPICE_REPORT OUTPUT
//
// The output is created exclusively. This is numerical source-reader evidence,
// not a physical accuracy bound or runtime-manifest admission.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"

	"github.com/dajiaohuang/solar/backend/internal/spk"
)

type window struct {
	StartET float64 `json:"startEt"`
	EndET   float64 `json:"endEt"`
}

type sourceIdentity struct {
	SHA256 string `json:"sha256"`
}

type packSource struct {
	ID           string `json:"id"`
	Target       int    `json:"target"`
	OriginalPath string `json:"originalPath"`
	SHA256       string `json:"sha256"`
}

type packFile struct {
	ID                string         `json:"id"`
	Path              string         `json:"path"`
	SHA256            string         `json:"sha256"`
	Bytes             int64          `json:"bytes"`
	Targets           []int          `json:"targets"`
	DependencyOnly    bool           `json:"dependencyOnly"`
	SolutionKernelIDs []string       `json:"solutionKernelIds"`
	SourceIdentity    sourceIdentity `json:"sourceIdentity"`
	externalPath      string         `json:"-"`
}

type externalDependency struct {
	ID     string `json:"id"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}

type externalDependencyReference struct {
	ID     string `json:"id"`
	SHA256 string `json:"sha256"`
}

type packManifest struct {
	RequestedWindow      window               `json:"requestedWindow"`
	Sources              []packSource         `json:"sources"`
	Source               *packSource          `json:"source"`
	ExternalDependencies []externalDependency `json:"externalDependencies"`
	Files                []packFile           `json:"files"`
}

type referenceSample struct {
	ET    float64   `json:"et"`
	State []float64 `json:"state"`
}

type referenceSource struct {
	ID         string            `json:"id"`
	Target     int               `json:"target"`
	SourceHash string            `json:"sourceSha256"`
	Samples    []referenceSample `json:"samples"`
}

type cspiceReport struct {
	ManifestHash         string                        `json:"manifestSha256"`
	GeneratorHash        string                        `json:"generatorSha256"`
	Frame                string                        `json:"frame"`
	Origin               string                        `json:"origin"`
	Aberration           string                        `json:"aberration"`
	ExternalDependencies []externalDependencyReference `json:"externalDependencies"`
	Sources              []referenceSource             `json:"sources"`
}

type loadedKernel struct {
	entry  packFile
	kernel *spk.Kernel
}

type sourceResult struct {
	ID                        string     `json:"id"`
	Target                    int        `json:"target"`
	OriginalSHA256            string     `json:"originalSha256"`
	DependencyKernelIDs       []string   `json:"dependencyKernelIds"`
	Samples                   int        `json:"samples"`
	GoType1Segments           int        `json:"goType1Segments"`
	MaximumAbsoluteDifference []float64  `json:"maximumAbsoluteComponentDifference"`
	MaximumDifferenceET       []*float64 `json:"maximumDifferenceEt"`
	ComponentUnits            []string   `json:"componentUnits"`
}

type outputReport struct {
	SchemaVersion         int            `json:"schemaVersion"`
	Comparison            string         `json:"comparison"`
	Frame                 string         `json:"frame"`
	Origin                string         `json:"origin"`
	Aberration            string         `json:"aberration"`
	ManifestSHA256        string         `json:"manifestSha256"`
	CSPICEReferenceSHA256 string         `json:"cspiceReferenceSha256"`
	GoReaderSHA256        string         `json:"goReaderSha256"`
	ComparatorSHA256      string         `json:"comparatorSha256"`
	GoVersion             string         `json:"goVersion"`
	Sources               []sourceResult `json:"sources"`
	Limitation            string         `json:"limitation"`
}

func digest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hashFile(file string) (string, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return "", err
	}
	return digest(data), nil
}

func sourcePath(root, relative string) (string, error) {
	if relative == "" || filepath.IsAbs(relative) {
		return "", errors.New("invalid path in spacecraft receipt")
	}
	full, err := filepath.Abs(filepath.Join(root, relative))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(root, full)
	if err != nil || rel == ".." || len(rel) > 3 && rel[:3] == ".."+string(filepath.Separator) || filepath.IsAbs(rel) {
		return "", errors.New("spacecraft receipt path escapes its pack")
	}
	return full, nil
}

func verifyFile(root, relative, expectedHash string) (string, error) {
	if len(expectedHash) != 64 {
		return "", errors.New("invalid SHA-256 in spacecraft receipt")
	}
	file, err := sourcePath(root, relative)
	if err != nil {
		return "", err
	}
	actual, err := hashFile(file)
	if err != nil {
		return "", err
	}
	if actual != expectedHash {
		return "", fmt.Errorf("spacecraft source hash mismatch: %s", relative)
	}
	return file, nil
}

func containsTarget(targets []int, target int) bool {
	for _, value := range targets {
		if value == target {
			return true
		}
	}
	return false
}

func toJ2000(state spk.State) ([6]float64, error) {
	out := [6]float64{state.Position.X, state.Position.Y, state.Position.Z, state.Velocity.X, state.Velocity.Y, state.Velocity.Z}
	if state.Frame == 17 {
		angle := 84381.448 / 3600 * math.Pi / 180
		c, s := math.Cos(angle), math.Sin(angle)
		out[1], out[2] = c*out[1]-s*out[2], s*out[1]+c*out[2]
		out[4], out[5] = c*out[4]-s*out[5], s*out[4]+c*out[5]
	} else if state.Frame != 1 {
		return out, fmt.Errorf("unsupported SPK reference frame %d", state.Frame)
	}
	return out, nil
}

func barycentric(target int, et float64, pool []*loadedKernel, cache map[int]*[6]float64, visiting map[int]bool) ([6]float64, bool, error) {
	if target == 0 {
		return [6]float64{}, true, nil
	}
	if state, ok := cache[target]; ok {
		if state == nil {
			return [6]float64{}, false, nil
		}
		return *state, true, nil
	}
	if visiting[target] || len(visiting) >= 32 {
		return [6]float64{}, false, fmt.Errorf("cyclic or deep source center chain at %d", target)
	}
	visiting[target] = true
	defer delete(visiting, target)
	for index := len(pool) - 1; index >= 0; index-- {
		state, found, err := pool[index].kernel.Evaluate(target, et)
		if err != nil {
			return [6]float64{}, false, err
		}
		if !found {
			continue
		}
		center, found, err := barycentric(state.Center, et, pool, cache, visiting)
		if err != nil {
			return [6]float64{}, false, err
		}
		if !found {
			return [6]float64{}, false, fmt.Errorf("missing source center %d for target %d at ET %.17g", state.Center, target, et)
		}
		relative, err := toJ2000(state)
		if err != nil {
			return [6]float64{}, false, err
		}
		for component := range relative {
			relative[component] += center[component]
		}
		cache[target] = &relative
		return relative, true, nil
	}
	cache[target] = nil
	return [6]float64{}, false, nil
}

func run() error {
	if len(os.Args) != 4 {
		return errors.New("usage: compare-spk-cspice-reference.go PACK CSPICE_REPORT OUTPUT")
	}
	packRoot, err := filepath.Abs(os.Args[1])
	if err != nil {
		return err
	}
	manifestPath := filepath.Join(packRoot, "prepared-manifest.json")
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return err
	}
	var manifest packManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return err
	}
	referenceBytes, err := os.ReadFile(os.Args[2])
	if err != nil {
		return err
	}
	var reference cspiceReport
	if err := json.Unmarshal(referenceBytes, &reference); err != nil {
		return err
	}
	sources := manifest.Sources
	if len(sources) == 0 && manifest.Source != nil {
		sources = append(sources, *manifest.Source)
	}
	_, comparatorFile, _, ok := runtime.Caller(0)
	if !ok {
		return errors.New("cannot identify comparator source")
	}
	repoRoot := filepath.Dir(filepath.Dir(comparatorFile))
	externalEntries := make(map[string]packFile, len(manifest.ExternalDependencies))
	if len(manifest.ExternalDependencies) > 0 {
		runtimeBytes, err := os.ReadFile(filepath.Join(repoRoot, "src", "data", "ephemeris-manifest-full.json"))
		if err != nil {
			return err
		}
		var runtimeManifest struct {
			Files []packFile `json:"files"`
		}
		if err := json.Unmarshal(runtimeBytes, &runtimeManifest); err != nil {
			return err
		}
		ephemerisRoot, err := filepath.Abs(filepath.Join(repoRoot, "public", "data", "ephemerides"))
		if err != nil {
			return err
		}
		for _, dependency := range manifest.ExternalDependencies {
			if dependency.ID == "" || len(dependency.SHA256) != 64 || dependency.Bytes < 1 {
				return errors.New("invalid external dependency receipt")
			}
			var entry *packFile
			for index := range runtimeManifest.Files {
				if runtimeManifest.Files[index].ID == dependency.ID {
					entry = &runtimeManifest.Files[index]
					break
				}
			}
			if entry == nil || entry.SHA256 != dependency.SHA256 || entry.Bytes != dependency.Bytes {
				return fmt.Errorf("runtime manifest dependency differs: %s", dependency.ID)
			}
			file, err := sourcePath(ephemerisRoot, entry.Path)
			if err != nil {
				return err
			}
			info, err := os.Stat(file)
			if err != nil {
				return err
			}
			actualHash, err := hashFile(file)
			if err != nil {
				return err
			}
			if info.Size() != dependency.Bytes || actualHash != dependency.SHA256 {
				return fmt.Errorf("external dependency bytes differ: %s", dependency.ID)
			}
			entry.DependencyOnly = true
			entry.externalPath = file
			externalEntries[dependency.ID] = *entry
		}
	}
	if len(reference.ExternalDependencies) != len(manifest.ExternalDependencies) {
		return errors.New("CSPICE reference external dependencies differ from prepared receipt")
	}
	for index, dependency := range manifest.ExternalDependencies {
		referenceDependency := reference.ExternalDependencies[index]
		if referenceDependency.ID != dependency.ID || referenceDependency.SHA256 != dependency.SHA256 {
			return errors.New("CSPICE reference external dependencies differ from prepared receipt")
		}
	}
	referenceGeneratorHash, err := hashFile(filepath.Join(repoRoot, "scripts", "reference-spacecraft-pack.py"))
	if err != nil {
		return err
	}
	if digest(manifestBytes) != reference.ManifestHash || reference.GeneratorHash != referenceGeneratorHash ||
		reference.Frame != "J2000" || reference.Origin != "SSB" || reference.Aberration != "NONE" ||
		len(sources) == 0 || len(manifest.Files) == 0 || len(reference.Sources) == 0 {
		return errors.New("CSPICE reference does not bind this prepared manifest, reference generator, or state convention")
	}
	readerHash, err := hashFile(filepath.Join(repoRoot, "internal", "spk", "spk.go"))
	if err != nil {
		return err
	}
	comparatorHash, err := hashFile(comparatorFile)
	if err != nil {
		return err
	}

	results := make([]sourceResult, 0, len(reference.Sources))
	for _, source := range reference.Sources {
		var receiptSource *packSource
		for index := range sources {
			if sources[index].ID == source.ID {
				receiptSource = &sources[index]
				break
			}
		}
		if receiptSource == nil || receiptSource.Target != source.Target || receiptSource.SHA256 != source.SourceHash {
			return fmt.Errorf("CSPICE reference source identity differs: %s", source.ID)
		}
		if _, err := verifyFile(packRoot, receiptSource.OriginalPath, receiptSource.SHA256); err != nil {
			return err
		}
		var entries []packFile
		for _, entry := range manifest.Files {
			if entry.SourceIdentity.SHA256 == receiptSource.SHA256 {
				entries = append(entries, entry)
			}
		}
		var roots []packFile
		for _, entry := range entries {
			if !entry.DependencyOnly && containsTarget(entry.Targets, receiptSource.Target) {
				roots = append(roots, entry)
			}
		}
		if len(roots) != 1 || len(roots[0].SolutionKernelIDs) == 0 {
			return fmt.Errorf("expected one explicitly pooled spacecraft root for %s", source.ID)
		}
		rootEntry := roots[0]
		pool := make([]*loadedKernel, 0, len(rootEntry.SolutionKernelIDs)+1)
		seenDependencies := map[string]bool{}
		for _, id := range rootEntry.SolutionKernelIDs {
			if seenDependencies[id] {
				return fmt.Errorf("duplicate dependency kernel %s", id)
			}
			seenDependencies[id] = true
			var found *packFile
			for index := range entries {
				if entries[index].ID == id && entries[index].DependencyOnly {
					found = &entries[index]
					break
				}
			}
			if found == nil {
				if entry, ok := externalEntries[id]; ok && entry.DependencyOnly {
					copy := entry
					found = &copy
				}
			}
			if found == nil {
				return fmt.Errorf("missing explicit dependency kernel %s", id)
			}
			pool = append(pool, &loadedKernel{entry: *found})
		}
		pool = append(pool, &loadedKernel{entry: rootEntry})
		for _, loaded := range pool {
			file := loaded.entry.externalPath
			if file == "" {
				file, err = verifyFile(packRoot, loaded.entry.Path, loaded.entry.SHA256)
				if err != nil {
					return err
				}
			}
			loaded.kernel, err = spk.Open(file)
			if err != nil {
				return fmt.Errorf("open Go SPK %s: %w", loaded.entry.Path, err)
			}
			defer loaded.kernel.Close()
			for _, target := range loaded.entry.Targets {
				if !containsTarget(func() []int {
					found := make([]int, 0, len(loaded.kernel.Segments))
					for _, segment := range loaded.kernel.Segments {
						if !containsTarget(found, segment.Target) {
							found = append(found, segment.Target)
						}
					}
					return found
				}(), target) {
					return fmt.Errorf("SPK target inventory differs: %s / %d", loaded.entry.Path, target)
				}
			}
		}
		if len(source.Samples) == 0 {
			return fmt.Errorf("CSPICE reference has no samples for %s", source.ID)
		}
		result := sourceResult{ID: source.ID, Target: source.Target, OriginalSHA256: receiptSource.SHA256,
			DependencyKernelIDs: append([]string(nil), rootEntry.SolutionKernelIDs...), Samples: len(source.Samples),
			MaximumAbsoluteDifference: make([]float64, 6), MaximumDifferenceET: make([]*float64, 6),
			ComponentUnits: []string{"km", "km", "km", "km/s", "km/s", "km/s"}}
		for _, segment := range pool[len(pool)-1].kernel.Segments {
			if segment.Target == source.Target && segment.Type == 1 {
				result.GoType1Segments++
			}
		}
		for _, sample := range source.Samples {
			if !finite(sample.ET) || sample.ET < manifest.RequestedWindow.StartET || sample.ET > manifest.RequestedWindow.EndET || len(sample.State) != 6 {
				return fmt.Errorf("invalid CSPICE sample for %s", source.ID)
			}
			cache := make(map[int]*[6]float64)
			actual, found, err := barycentric(source.Target, sample.ET, pool, cache, make(map[int]bool))
			if err != nil {
				return err
			}
			if !found {
				return fmt.Errorf("Go SPK reader has no state for %s at ET %.17g", source.ID, sample.ET)
			}
			for component := 0; component < 6; component++ {
				if !finite(actual[component]) || !finite(sample.State[component]) {
					return fmt.Errorf("nonfinite SPK state for %s at ET %.17g", source.ID, sample.ET)
				}
				difference := math.Abs(actual[component] - sample.State[component])
				if difference > result.MaximumAbsoluteDifference[component] {
					result.MaximumAbsoluteDifference[component] = difference
					et := sample.ET
					result.MaximumDifferenceET[component] = &et
				}
			}
		}
		results = append(results, result)
	}

	output := outputReport{SchemaVersion: 1,
		Comparison: "Solar Go SPK reader and explicit source-chain sum versus CSPICE SPK state reference",
		Frame:      "J2000", Origin: "SSB", Aberration: "NONE", ManifestSHA256: reference.ManifestHash,
		CSPICEReferenceSHA256: digest(referenceBytes), GoReaderSHA256: readerHash, ComparatorSHA256: comparatorHash,
		GoVersion: runtime.Version(), Sources: results,
		Limitation: "Sampled implementation agreement with CSPICE for the bound source bytes only; this is not an observation-fit accuracy bound or runtime-manifest admission."}
	encoded, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	out, err := os.OpenFile(os.Args[3], os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := out.Write(encoded); err != nil {
		return err
	}
	brief := make([]map[string]any, 0, len(results))
	for _, result := range results {
		brief = append(brief, map[string]any{"id": result.ID, "samples": result.Samples,
			"maximumAbsoluteComponentDifference": result.MaximumAbsoluteDifference})
	}
	console, err := json.Marshal(brief)
	if err != nil {
		return err
	}
	fmt.Println(string(console))
	return nil
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
