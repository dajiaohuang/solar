package catalog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/dajiaohuang/solar/backend/internal/science"
	"github.com/dajiaohuang/solar/backend/internal/spk"
)

const APIVersion = "solar.api/v1"

const (
	maxManifestKernelFiles = 2048
	globalKernelCacheBytes = 128 << 20
)

type Availability string

const (
	AvailableOperational Availability = "operational"
	AvailableFallback    Availability = "fallback"
	AvailableSnapshot    Availability = "snapshot"
	Missing              Availability = "missing"
)

type Body struct {
	ID                 string       `json:"id"`
	NAIFID             int          `json:"naifId,omitempty"`
	Name               string       `json:"name"`
	Kind               string       `json:"kind"`
	ParentID           string       `json:"parentId,omitempty"`
	Source             string       `json:"source"`
	IdentityStatus     string       `json:"identityStatus,omitempty"`
	EphemerisStatus    string       `json:"ephemerisStatus,omitempty"`
	SourceURL          string       `json:"sourceUrl,omitempty"`
	SourceSHA256       string       `json:"sourceSha256,omitempty"`
	SourceEphemerides  []string     `json:"sourceEphemerides,omitempty"`
	PrimaryNAIFID      int          `json:"primaryNaifId,omitempty"`
	SystemNAIFID       int          `json:"systemNaifId,omitempty"`
	Provenance         string       `json:"provenance,omitempty"`
	DatasetVersion     string       `json:"datasetVersion"`
	Availability       Availability `json:"availability"`
	MissingReason      string       `json:"missingReason,omitempty"`
	ValidityStartET    float64      `json:"validityStartEt,omitempty"`
	ValidityEndET      float64      `json:"validityEndEt,omitempty"`
	EpochJD            float64      `json:"epochJd,omitempty"`
	EpochTimeScale     string       `json:"epochTimeScale,omitempty"`
	ReferenceFrame     string       `json:"referenceFrame,omitempty"`
	Model              string       `json:"model,omitempty"`
	KernelSHA256       string       `json:"kernelSha256,omitempty"`
	PositionRepresents string       `json:"positionRepresents,omitempty"`
	Elements           *Elements    `json:"elements,omitempty"`
	InitialState       *State       `json:"initialStateKm,omitempty"`
}

type Elements struct {
	SemiMajorAxisAU     float64 `json:"semiMajorAxisAU"`
	Eccentricity        float64 `json:"eccentricity"`
	InclinationDeg      float64 `json:"inclinationDeg"`
	AscendingNodeDeg    float64 `json:"ascendingNodeDeg"`
	ArgPeriapsisDeg     float64 `json:"argPeriapsisDeg"`
	MeanAnomalyDeg      float64 `json:"meanAnomalyDeg"`
	MeanMotionDegPerDay float64 `json:"meanMotionDegPerDay"`
}

type Vec3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}
type State struct {
	Position Vec3 `json:"position"`
	Velocity Vec3 `json:"velocity"`
}

type Catalog struct {
	evaluations       evaluationCache
	bodies            []Body
	byID              map[string]Body
	version           string
	manifestHash      string
	manifestProfile   string
	manifestContract  string
	manifestFiles     int
	manifestTargets   int
	packagedFiles     int
	kernelCacheBudget int64
	kernels           map[string]*kernelBinding
	byTarget          map[int][]*kernelBinding
}

type kernelBinding struct {
	id             string
	sha256         string
	path           string
	bytes          int64
	startET        float64
	endET          float64
	kernel         *spk.Kernel
	dependencyOnly bool
	explicitPool   bool
	solutionIDs    []string
	mu             sync.Mutex
	loading        bool
	ready          chan struct{}
	closed         bool
	verified       bool
	terminalErr    error
	integrityBytes int64
	integrityReads uint64
}

var errCatalogClosed = errors.New("catalog is closed")

// Kept as a narrow seam for lifecycle regression checks. Production code
// always uses the SPK package implementation with verified page digests.
var openKernelWithVerifiedPages = spk.OpenWithPageHashes

type manifest struct {
	ID       string         `json:"id"`
	Profile  string         `json:"profile"`
	Contract string         `json:"contract"`
	Files    []manifestFile `json:"files"`
}
type manifestFile struct {
	ID                string   `json:"id"`
	Path              string   `json:"path"`
	Targets           []int    `json:"targets"`
	StartET           float64  `json:"startEt"`
	EndET             float64  `json:"endEt"`
	DependencyOnly    bool     `json:"dependencyOnly"`
	SolutionKernelIDs []string `json:"solutionKernelIds"`
	SHA256            string   `json:"sha256"`
	Bytes             int64    `json:"bytes"`
}
type ephemerisBodyFile struct {
	EpochJD float64 `json:"epochJd"`
	Bodies  []struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		ShortName string `json:"shortName"`
		Kind      string `json:"kind"`
		NAIFID    int    `json:"naifId"`
		ParentID  string `json:"parentId"`
		Source    string `json:"source"`
		Orbit     struct {
			Model               string  `json:"model"`
			EpochJD             float64 `json:"epochJd"`
			SemiMajorAxisAU     float64 `json:"semiMajorAxisAU"`
			Eccentricity        float64 `json:"eccentricity"`
			InclinationDeg      float64 `json:"inclinationDeg"`
			AscendingNodeDeg    float64 `json:"ascendingNodeDeg"`
			ArgPeriapsisDeg     float64 `json:"argPeriapsisDeg"`
			MeanAnomalyDeg      float64 `json:"meanAnomalyDeg"`
			MeanMotionDegPerDay float64 `json:"meanMotionDegPerDay"`
		} `json:"orbit"`
		ParentRelativeStateKm *struct {
			Position Vec3 `json:"position"`
			Velocity Vec3 `json:"velocity"`
		} `json:"parentRelativeStateKm"`
	} `json:"bodies"`
}

type sourceOnlyFile struct {
	SchemaVersion int              `json:"schemaVersion"`
	Bodies        []sourceOnlyBody `json:"bodies"`
}

type sourceOnlyBody struct {
	ID                string   `json:"id"`
	NAIFID            int      `json:"naifId"`
	Name              string   `json:"name"`
	Kind              string   `json:"kind"`
	Source            string   `json:"source"`
	IdentityStatus    string   `json:"identityStatus"`
	EphemerisStatus   string   `json:"ephemerisStatus"`
	MissingReason     string   `json:"missingReason"`
	SourceEphemerides []string `json:"sourceEphemerides"`
	SourceURL         string   `json:"sourceUrl"`
	SourceSHA256      string   `json:"sourceSha256"`
	PrimaryNAIFID     int      `json:"primaryNaifId"`
	SystemNAIFID      int      `json:"systemNaifId"`
	Provenance        string   `json:"provenance"`
}

// Load requires a deliberate data directory. It never downloads or guesses a path.
// Manifest targets are retained even when their binary kernel is not packaged.
func Load(dataDir string) (*Catalog, error) {
	if dataDir == "" {
		return nil, fmt.Errorf("data directory is empty")
	}
	dataDir, _ = filepath.Abs(dataDir)
	m := manifest{}
	manifestPath := filepath.Join(dataDir, "ephemeris-manifest.json")
	// Prefer the complete client profile when it is shipped next to the Pages
	// manifest. A curated profile remains selectable via a separate data dir.
	if fileExists(filepath.Join(dataDir, "ephemeris-manifest-full.json")) {
		manifestPath = filepath.Join(dataDir, "ephemeris-manifest-full.json")
	}
	mb, err := os.ReadFile(manifestPath)
	if err != nil {
		return loadBuiltins(fmt.Errorf("read manifest: %w", err))
	}
	if err := json.Unmarshal(mb, &m); err != nil {
		return loadBuiltins(fmt.Errorf("parse manifest: %w", err))
	}
	if len(m.Files) > maxManifestKernelFiles {
		return loadBuiltins(fmt.Errorf("manifest has %d files; limit is %d", len(m.Files), maxManifestKernelFiles))
	}
	h := sha256.Sum256(mb)
	sourceOnly, sourceOnlyErr := readSourceOnlyBodies(dataDir, m.ID)
	if sourceOnlyErr != nil {
		return loadBuiltins(sourceOnlyErr)
	}
	perKernelCache := int64(spk.DefaultCacheBytes)
	if len(m.Files) > 0 && perKernelCache*int64(len(m.Files)) > globalKernelCacheBytes {
		perKernelCache = globalKernelCacheBytes / int64(len(m.Files))
	}
	if perKernelCache < spk.DefaultPageSize {
		perKernelCache = spk.DefaultPageSize
	}
	c := &Catalog{byID: make(map[string]Body), kernels: make(map[string]*kernelBinding), byTarget: make(map[int][]*kernelBinding), version: m.ID, manifestHash: hex.EncodeToString(h[:]), manifestProfile: m.Profile, manifestContract: m.Contract, manifestFiles: len(m.Files), kernelCacheBudget: perKernelCache * int64(len(m.Files))}
	manifestTargetIDs := make(map[int]struct{})
	// Keep stable, well-known body identities available even without the large kernels.
	for _, b := range builtins() {
		c.add(b)
	}
	for _, b := range sourceOnly {
		c.add(b)
	}
	for _, f := range m.Files {
		for _, target := range f.Targets {
			manifestTargetIDs[target] = struct{}{}
		}
		pathValid := validRelativeDataPath(f.Path)
		kernelPath := ""
		if pathValid {
			kernelPath = filepath.Join(dataDir, f.Path)
		}
		present := pathValid && fileExists(kernelPath)
		var binding *kernelBinding
		manifestIdentityValid := pathValid && validManifestIdentity(f)
		if present && manifestIdentityValid {
			// Keep manifest identity and target coverage available immediately,
			// but defer the full-byte integrity read and SPK parse until a request
			// actually needs this kernel. The binding cannot evaluate a state until
			// kernelFor has completed both checks.
			binding = &kernelBinding{id: f.ID, sha256: f.SHA256, path: kernelPath, bytes: f.Bytes, startET: f.StartET, endET: f.EndET, dependencyOnly: f.DependencyOnly, explicitPool: f.SolutionKernelIDs != nil, solutionIDs: append([]string(nil), f.SolutionKernelIDs...)}
			c.kernels[f.ID] = binding
			c.packagedFiles++
			for _, target := range f.Targets {
				c.byTarget[target] = append(c.byTarget[target], binding)
			}
		}
		// Embedded center kernels are usable only inside declared pools.
		// They must not create/promote public root identities or replace their
		// source hash and apparent validity interval while loading a spacecraft.
		if f.DependencyOnly {
			continue
		}
		for _, naif := range f.Targets {
			id := "naif:" + strconv.Itoa(naif)
			if existing, ok := c.byID[id]; ok && existing.EphemerisStatus == "source-only-missing-compatible-system" {
				// A source-only identity is deliberately not promoted merely because
				// a future manifest happens to reuse its component target. The
				// sidecar must be regenerated with an explicit compatible center.
				continue
			}
			b, ok := c.byID[id]
			if !ok {
				b = Body{ID: id, NAIFID: naif, Name: "NAIF " + strconv.Itoa(naif), Kind: "unknown", Source: f.ID, DatasetVersion: m.ID, Availability: Missing}
			}
			if b.ValidityStartET == 0 || f.StartET < b.ValidityStartET {
				b.ValidityStartET = f.StartET
			}
			if f.EndET > b.ValidityEndET {
				b.ValidityEndET = f.EndET
			}
			if binding != nil {
				b.Availability = AvailableOperational
				b.MissingReason = ""
			} else if present {
				b.Availability = Missing
				if manifestIdentityValid {
					b.MissingReason = "kernel-invalid"
				} else {
					b.MissingReason = "kernel-unverified"
				}
			} else if !pathValid {
				b.Availability = Missing
				b.MissingReason = "kernel-not-packaged"
			} else if b.Availability != AvailableFallback {
				b.Availability = Missing
				b.MissingReason = "kernel-not-packaged"
			}
			b.DatasetVersion = m.ID
			if f.SHA256 != "" {
				b.KernelSHA256 = f.SHA256
			}
			c.add(b)
		}
	}
	c.manifestTargets = len(manifestTargetIDs)
	if eb, e := os.ReadFile(filepath.Join(dataDir, "ephemerisBodies.json")); e == nil {
		var f ephemerisBodyFile
		if json.Unmarshal(eb, &f) == nil {
			for _, x := range f.Bodies {
				c.add(fromEphemeris(x, m.ID, f.EpochJD))
			}
		}
	}
	for id, b := range c.byID {
		if b.EphemerisStatus == "source-only-missing-compatible-system" {
			continue
		}
		if b.NAIFID != 0 && c.hasOperationalRoot(b.NAIFID) {
			b.Availability = AvailableOperational
			b.MissingReason = ""
			b.Model = "spk-original"
			c.byID[id] = b
		}
	}
	c.rebuild()
	return c, nil
}

func (c *Catalog) hasOperationalRoot(target int) bool {
	for _, binding := range c.byTarget[target] {
		if !binding.dependencyOnly {
			return true
		}
	}
	return false
}

func readSourceOnlyBodies(dataDir, version string) ([]Body, error) {
	raw, err := os.ReadFile(filepath.Join(dataDir, "sourceOnlyBodies.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read source-only identities: %w", err)
	}
	var file sourceOnlyFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return nil, fmt.Errorf("parse source-only identities: %w", err)
	}
	if file.SchemaVersion != 1 || len(file.Bodies) == 0 || len(file.Bodies) > 64 {
		return nil, fmt.Errorf("invalid source-only identity file")
	}
	seen := make(map[string]struct{}, len(file.Bodies))
	result := make([]Body, 0, len(file.Bodies))
	for _, source := range file.Bodies {
		if !strings.HasPrefix(source.ID, "naif:") || source.NAIFID <= 0 || source.ID != "naif:"+strconv.Itoa(source.NAIFID) || source.Name == "" || source.Kind == "" || source.Source == "" || source.IdentityStatus == "" || source.EphemerisStatus != "source-only-missing-compatible-system" || source.MissingReason == "" || source.SourceURL == "" || !validSHA256(source.SourceSHA256) || len(source.SourceEphemerides) == 0 || source.PrimaryNAIFID <= 0 || source.SystemNAIFID <= 0 || source.Provenance == "" {
			return nil, fmt.Errorf("invalid source-only identity %q", source.ID)
		}
		if _, ok := seen[source.ID]; ok {
			return nil, fmt.Errorf("duplicate source-only identity %q", source.ID)
		}
		seen[source.ID] = struct{}{}
		result = append(result, Body{ID: source.ID, NAIFID: source.NAIFID, Name: source.Name, Kind: source.Kind, Source: source.Source,
			IdentityStatus: source.IdentityStatus, EphemerisStatus: source.EphemerisStatus, SourceURL: source.SourceURL,
			SourceSHA256: source.SourceSHA256, SourceEphemerides: append([]string(nil), source.SourceEphemerides...),
			PrimaryNAIFID: source.PrimaryNAIFID, SystemNAIFID: source.SystemNAIFID, Provenance: source.Provenance,
			DatasetVersion: version, Availability: Missing, MissingReason: source.MissingReason, Model: "exact-only"})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

func validSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

// verifyManifestFile is intentionally strict for a file that is present on
// disk: both byte length and SHA-256 are required before the bytes can become
// an operational kernel. Missing manifest identity must never silently turn
// into an exact state source.
func verifyManifestFile(raw []byte, file manifestFile) bool {
	if !validManifestIdentity(file) || int64(len(raw)) != file.Bytes {
		return false
	}
	digest := strings.TrimSpace(file.SHA256)
	sum := sha256.Sum256(raw)
	return strings.EqualFold(hex.EncodeToString(sum[:]), digest)
}

func verifyManifestPathContext(ctx context.Context, path string, file manifestFile) (bool, [][32]byte, int64, error) {
	if !validManifestIdentity(file) {
		return false, nil, 0, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	pageSize := int64(spk.DefaultPageSize)
	pageCount := 1 + (file.Bytes-1)/pageSize
	maxInt := int64(int(^uint(0) >> 1))
	if pageCount > maxInt {
		return false, nil, 0, fmt.Errorf("kernel has too many pages to verify: %d", pageCount)
	}
	f, err := os.Open(path)
	if err != nil {
		return false, nil, 0, err
	}
	defer f.Close()
	h := sha256.New()
	buf := make([]byte, int(pageSize))
	pageHashes := make([][32]byte, 0, int(pageCount))
	var n int64
	for n < file.Bytes {
		if err := ctx.Err(); err != nil {
			return false, nil, n, err
		}
		length := pageSize
		if remaining := file.Bytes - n; remaining < length {
			length = remaining
		}
		page := buf[:int(length)]
		read, readErr := io.ReadFull(f, page)
		if read != len(page) {
			return false, nil, n + int64(read), readErr
		}
		if _, err := h.Write(page); err != nil {
			return false, nil, n, err
		}
		pageHashes = append(pageHashes, sha256.Sum256(page))
		n += int64(read)
	}
	var extra [1]byte
	read, readErr := f.Read(extra[:])
	if read > 0 {
		return false, nil, n + int64(read), nil
	}
	if readErr != io.EOF {
		if readErr == nil {
			readErr = io.ErrNoProgress
		}
		return false, nil, n, readErr
	}
	digest := strings.TrimSpace(file.SHA256)
	if !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), digest) {
		return false, nil, n, nil
	}
	return true, pageHashes, n, nil
}

// kernelFor verifies the manifest-declared bytes and parses the SPK lazily.
// Only one goroutine performs the potentially large read per kernel; other
// callers wait with cancellation rather than duplicating I/O or retaining a
// second kernel. Integrity and parse failures are terminal for this catalog;
// caller cancellation is retryable.
func (b *kernelBinding) kernelFor(ctx context.Context, pageCacheBytes int64) (*spk.Kernel, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		b.mu.Lock()
		if b.closed {
			b.mu.Unlock()
			return nil, errCatalogClosed
		}
		if b.kernel != nil {
			k := b.kernel
			b.mu.Unlock()
			return k, nil
		}
		if b.terminalErr != nil {
			err := b.terminalErr
			b.mu.Unlock()
			return nil, err
		}
		if b.loading {
			ready := b.ready
			b.mu.Unlock()
			select {
			case <-ready:
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		b.loading = true
		b.ready = make(chan struct{})
		ready := b.ready
		b.mu.Unlock()

		verified, pageHashes, integrityBytes, err := verifyManifestPathContext(ctx, b.path, manifestFile{SHA256: b.sha256, Bytes: b.bytes})
		if err == nil && !verified {
			err = fmt.Errorf("kernel %s failed manifest integrity verification", b.id)
		}
		var kernel *spk.Kernel
		if err == nil {
			kernel, err = openKernelWithVerifiedPages(b.path, spk.DefaultPageSize, pageCacheBytes, pageHashes)
		}

		b.mu.Lock()
		b.loading = false
		b.integrityReads++
		b.integrityBytes += integrityBytes
		closed := b.closed
		if cancelled := ctx.Err(); cancelled != nil {
			err = cancelled
		}
		if err == nil && closed {
			err = errCatalogClosed
		}
		if err == nil {
			b.kernel = kernel
			b.verified = true
		} else if !closed && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			b.terminalErr = err
		}
		if err != nil && kernel != nil {
			// Close while holding the binding lock and before waking Close's
			// waiter. Otherwise Catalog.Close could observe ready closed and
			// return while this newly opened resource was still live.
			_ = kernel.Close()
			kernel = nil
		}
		close(ready)
		b.ready = nil
		b.mu.Unlock()
		return kernel, err
	}
}

func (b *kernelBinding) status() (verified, pending, invalid bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.verified, b.kernel == nil && b.terminalErr == nil, b.terminalErr != nil
}

func validManifestIdentity(file manifestFile) bool {
	digest := strings.TrimSpace(file.SHA256)
	if file.Bytes <= 0 || len(digest) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(digest)
	return err == nil
}

func validRelativeDataPath(path string) bool {
	clean := filepath.Clean(path)
	return path != "" && !filepath.IsAbs(path) && clean == path && clean != ".." && !strings.HasPrefix(clean, ".."+string(filepath.Separator))
}

func loadBuiltins(err error) (*Catalog, error) {
	c := &Catalog{byID: make(map[string]Body), version: "unavailable", manifestHash: "", manifestProfile: "unavailable"}
	for _, b := range builtins() {
		c.add(b)
	}
	return c, err
}
func fileExists(p string) bool { st, err := os.Stat(p); return err == nil && !st.IsDir() }
func (c *Catalog) add(b Body) {
	if b.ID == "" {
		return
	}
	c.byID[b.ID] = b
	c.rebuild()
}
func (c *Catalog) rebuild() {
	c.bodies = c.bodies[:0]
	for _, x := range c.byID {
		c.bodies = append(c.bodies, x)
	}
	sort.Slice(c.bodies, func(i, j int) bool { return c.bodies[i].ID < c.bodies[j].ID })
}
func (c *Catalog) Len() int                 { return len(c.bodies) }
func (c *Catalog) Version() string          { return c.version }
func (c *Catalog) ManifestHash() string     { return c.manifestHash }
func (c *Catalog) ManifestProfile() string  { return c.manifestProfile }
func (c *Catalog) ManifestContract() string { return c.manifestContract }
func (c *Catalog) Close() error {
	c.evaluations.close()
	// Mark every binding before waiting on any one loader. This prevents a
	// second binding from publishing a kernel while Close is waiting on the
	// first one.
	for _, binding := range c.kernels {
		binding.mu.Lock()
		binding.closed = true
		binding.mu.Unlock()
	}
	var firstErr error
	for _, binding := range c.kernels {
		var kernel *spk.Kernel
		for {
			binding.mu.Lock()
			ready := binding.ready
			if ready == nil {
				kernel = binding.kernel
				binding.kernel = nil
				binding.mu.Unlock()
				break
			}
			binding.mu.Unlock()
			<-ready
		}
		if kernel != nil {
			if err := kernel.Close(); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}
func (c *Catalog) Stats() map[string]int {
	out := map[string]int{"catalogEntries": len(c.bodies), "manifestFiles": c.manifestFiles, "manifestTargets": c.manifestTargets, "packagedFiles": c.packagedFiles, "kernelPageCacheBytesMax": int(c.kernelCacheBudget)}
	for _, binding := range c.kernels {
		verified, pending, invalid := binding.status()
		if verified {
			out["kernelFilesVerified"]++
		} else if pending {
			out["kernelFilesPending"]++
		} else if invalid {
			out["kernelFilesInvalid"]++
		}
	}
	for _, b := range c.bodies {
		out[string(b.Availability)]++
	}
	return out
}

// IntegrityStats reports the deferred manifest reads separately from SPK page
// traffic. A pending file has performed no integrity I/O, while an invalid
// file remains excluded from exact evaluation after its failed attempt.
func (c *Catalog) IntegrityStats() map[string]uint64 {
	out := map[string]uint64{"reads": 0, "bytesRead": 0, "verified": 0, "pending": 0, "invalid": 0}
	for _, binding := range c.kernels {
		binding.mu.Lock()
		out["reads"] += binding.integrityReads
		if binding.integrityBytes > 0 {
			out["bytesRead"] += uint64(binding.integrityBytes)
		}
		verified, pending, invalid := binding.verified, binding.kernel == nil && binding.terminalErr == nil, binding.terminalErr != nil
		binding.mu.Unlock()
		if verified {
			out["verified"]++
		} else if pending {
			out["pending"]++
		} else if invalid {
			out["invalid"]++
		}
	}
	return out
}

// ReadStats aggregates only kernels that have been requested and verified.
// Pending files intentionally contribute no I/O, making lazy integrity costs
// visible instead of being mistaken for startup work.
func (c *Catalog) ReadStats() spk.ReadStats {
	var out spk.ReadStats
	for _, binding := range c.kernels {
		binding.mu.Lock()
		kernel := binding.kernel
		binding.mu.Unlock()
		if kernel == nil {
			continue
		}
		stats := kernel.ReadStats()
		if out.PageSize == 0 {
			out.PageSize = stats.PageSize
		}
		out.MaxBytes += stats.MaxBytes
		out.CachedBytes += stats.CachedBytes
		out.LoadedBytes += stats.LoadedBytes
		out.IntegrityIndexBytes += stats.IntegrityIndexBytes
		out.PageLoads += stats.PageLoads
		out.CacheHits += stats.CacheHits
		out.CacheMisses += stats.CacheMisses
	}
	return out
}

func (c *Catalog) AuditIdentityTuples() []map[string]string {
	type identity struct{ source, datasetVersion, model string }
	seen := make(map[identity]struct{})
	for _, body := range c.bodies {
		model := body.Model
		switch body.Availability {
		case AvailableFallback:
			// State plans and tiles are exact-only; fallback catalog elements
			// are not an identity they can emit.
			model = "exact-only"
		case Missing:
			if body.Source != "" && body.DatasetVersion != "" {
				model = "unavailable-no-kernel"
			}
		}
		if body.Source == "" || body.DatasetVersion == "" || model == "" {
			continue
		}
		seen[identity{body.Source, body.DatasetVersion, model}] = struct{}{}
	}
	items := make([]identity, 0, len(seen))
	for value := range seen {
		items = append(items, value)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].source != items[j].source {
			return items[i].source < items[j].source
		}
		if items[i].datasetVersion != items[j].datasetVersion {
			return items[i].datasetVersion < items[j].datasetVersion
		}
		return items[i].model < items[j].model
	})
	out := make([]map[string]string, 0, len(items))
	for _, value := range items {
		out = append(out, map[string]string{"source": value.source, "datasetVersion": value.datasetVersion, "model": value.model})
	}
	return out
}
func (c *Catalog) Get(id string) (Body, bool) { b, ok := c.byID[id]; return b, ok }

// KernelSHA256 returns the verified manifest digest for a loaded kernel ID.
// It is intentionally unavailable for missing, invalid, or unparsed files.
func (c *Catalog) KernelSHA256(id string) (string, bool) {
	binding, ok := c.kernels[id]
	if !ok || binding == nil || binding.sha256 == "" {
		return "", false
	}
	if _, err := binding.kernelFor(context.Background(), c.kernelCacheBudgetForBinding()); err != nil {
		return "", false
	}
	return binding.sha256, true
}

// KernelMissingReason reports a stable wire-level reason only for a manifest
// kernel that failed lazy verification or parsing. A pending or verified
// kernel returns an empty reason; epoch coverage gaps are decided by the
// resolver and are not integrity failures.
func (c *Catalog) KernelMissingReason(id string) string {
	binding, ok := c.kernels[id]
	if !ok || binding == nil {
		return ""
	}
	binding.mu.Lock()
	defer binding.mu.Unlock()
	if binding.terminalErr != nil {
		return "kernel-invalid"
	}
	return ""
}

func (c *Catalog) kernelCacheBudgetForBinding() int64 {
	if len(c.kernels) == 0 || c.kernelCacheBudget <= 0 {
		return spk.DefaultCacheBytes
	}
	return c.kernelCacheBudget / int64(len(c.kernels))
}

// OperationalKernelSHA256 identifies the verified kernel selected for an
// operational target at an epoch. This follows the same root-selection path
// as OperationalStatesContext, so provenance cannot drift from evaluated data.
func (c *Catalog) OperationalKernelSHA256(id string, jd float64) (string, bool, error) {
	b, ok := c.byID[id]
	if !ok || b.NAIFID == 0 || !validFloat(jd) {
		return "", false, nil
	}
	et := (jd - 2451545.0) * 86400
	root, err := c.operationalRoot(context.Background(), b.NAIFID, et)
	if err != nil {
		return "", false, err
	}
	if root == nil || root.sha256 == "" {
		return "", false, nil
	}
	return root.sha256, true, nil
}

// OperationalProvenance describes the manifest file and selected SPK segment
// that produced an operational state at jd. It deliberately follows the
// same root-selection path as OperationalStatesContext; catalog aliases (for
// example "earth" and "naif:399") therefore cannot report builtin metadata
// for a state evaluated from a packaged kernel.
type OperationalProvenance struct {
	Source            string
	KernelSHA256      string
	SourceChainSHA256 string
	CenterID          string
	SegmentFrame      int
	SegmentType       int
	ValidityStartET   float64
	ValidityEndET     float64
	ValidityPresent   bool
}

func (c *Catalog) OperationalProvenance(id string, jd float64) (OperationalProvenance, bool, error) {
	_, found, evidence, err := c.EvalBatchContext(context.Background(), []string{id}, jd)
	return evidence[id], found[id], err
}

func (c *Catalog) Page(query string, offset, limit int) []Body {
	q := strings.ToLower(strings.TrimSpace(query))
	out := make([]Body, 0, limit)
	for _, b := range c.bodies {
		if q != "" && !strings.Contains(strings.ToLower(b.ID+" "+b.Name+" "+b.Source), q) {
			continue
		}
		if offset > 0 {
			offset--
			continue
		}
		out = append(out, b)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// OperationalState resolves one source-kernel state and its center chain at a
// TDB Julian epoch. It delegates to the batch resolver so single and batch
// requests share exactly the same root selection and center-chain semantics.
func (c *Catalog) OperationalState(id string, jd float64) (State, bool, error) {
	states, found, err := c.OperationalStates([]string{id}, jd)
	return states[id], found[id], err
}

// OperationalStates resolves several targets at one TDB epoch. Kernel
// evaluation is memoized by target and solution-kernel pool, so sibling bodies
// sharing a center or a manifest solution set do not repeat the same work.
// Results retain input IDs only when an exact operational state is available.
func (c *Catalog) OperationalStates(ids []string, jd float64) (map[string]State, map[string]bool, error) {
	return c.OperationalStatesContext(context.Background(), ids, jd)
}

func (c *Catalog) OperationalStatesContext(ctx context.Context, ids []string, jd float64) (map[string]State, map[string]bool, error) {
	states, found, _, err := c.EvalBatchContext(ctx, ids, jd)
	return states, found, err
}

// EvalBatchContext returns numerical states and the evidence from the same
// evaluation. Resolver scratch is epoch-local; the catalog-owned bounded cache
// shares immutable final state/provenance values at exact epochs across calls.
// Aliases reuse both coefficient work and center chains.
func (c *Catalog) EvalBatchContext(ctx context.Context, ids []string, jd float64) (map[string]State, map[string]bool, map[string]OperationalProvenance, error) {
	return c.EvalBatchContextWithAdmission(ctx, ids, jd, "", nil)
}

// EvalBatchContextWithAdmission scopes only in-flight coalescing; completed
// exact states remain shared across scopes. The admission callback runs only
// for cache-miss flights this request owns, so coalesced waiters do not occupy
// a compute slot. Each slot is released after that target's calculation;
// holding it across the rest of a batch could deadlock against another queued
// batch. Callers with priority queues should use a stable scope per queue to
// prevent a lower-priority builder from delaying a higher-priority request.
func (c *Catalog) EvalBatchContextWithAdmission(ctx context.Context, ids []string, jd float64, scope string,
	admission func(context.Context) (func(), error)) (map[string]State, map[string]bool, map[string]OperationalProvenance, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, nil, err
	}
	if !validFloat(jd) {
		return make(map[string]State), make(map[string]bool), make(map[string]OperationalProvenance), nil
	}
	et := (jd - 2451545.0) * 86400
	return c.EvalBatchContextAtETWithAdmission(ctx, ids, et, scope, admission)
}

// EvalBatchContextAtET evaluates at seconds past J2000 TDB. It preserves the
// precision of split Julian dates from SOFA and avoids rounding them to a
// one-part JD before SPK segment selection and evaluation.
func (c *Catalog) EvalBatchContextAtET(ctx context.Context, ids []string, et float64) (map[string]State, map[string]bool, map[string]OperationalProvenance, error) {
	return c.EvalBatchContextAtETWithAdmission(ctx, ids, et, "", nil)
}

// EvalBatchContextAtETWithAdmission is the ET-seconds counterpart to
// EvalBatchContextWithAdmission. Epoch keys and all operational SPK evaluation
// use the same J2000-relative seconds value.
func (c *Catalog) EvalBatchContextAtETWithAdmission(ctx context.Context, ids []string, et float64, scope string,
	admission func(context.Context) (func(), error)) (map[string]State, map[string]bool, map[string]OperationalProvenance, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, nil, err
	}
	states := make(map[string]State, len(ids))
	found := make(map[string]bool, len(ids))
	evidence := make(map[string]OperationalProvenance, len(ids))
	if !validFloat(et) || len(c.byTarget) == 0 {
		return states, found, evidence, nil
	}
	cache := make(map[operationalCacheKey]operationalCacheEntry, len(ids)*2)
	raw := make(map[rawEvaluationKey]operationalCacheEntry)
	acquireAdmission := func(evalCtx context.Context) (func(), error) {
		if admission == nil {
			return nil, evalCtx.Err()
		}
		release, err := admission(evalCtx)
		if err != nil {
			if release != nil {
				release()
			}
			return nil, err
		}
		if err := evalCtx.Err(); err != nil {
			if release != nil {
				release()
			}
			return nil, err
		}
		return release, nil
	}
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return nil, nil, nil, err
		}
		b, ok := c.byID[id]
		if !ok || b.NAIFID == 0 {
			continue
		}
		value, exact, err := c.evaluations.load(ctx, b.NAIFID, et, scope, func(evalCtx context.Context) (evaluationValue, bool, error) {
			releaseAdmission, err := acquireAdmission(evalCtx)
			if err != nil {
				return evaluationValue{}, false, err
			}
			if releaseAdmission != nil {
				defer releaseAdmission()
			}
			root, err := c.operationalRootCached(evalCtx, b.NAIFID, et, raw)
			if err != nil || root == nil {
				return evaluationValue{}, false, err
			}
			allowed, pool, complete, err := c.operationalPool(root)
			if err != nil || !complete {
				return evaluationValue{}, false, err
			}
			st, ok, err := c.resolveOperationalSession(evalCtx, b.NAIFID, et, allowed, pool, cache, map[int]bool{}, raw)
			if err != nil || !ok {
				return evaluationValue{}, false, err
			}
			state := State{Position: toEcliptic(st.Position, st.Frame), Velocity: toEcliptic(st.Velocity, st.Frame)}
			provenance := cache[operationalCacheKey{target: b.NAIFID, pool: pool}].provenance
			return evaluationValue{state: state, provenance: provenance}, true, nil
		})
		if err != nil {
			return nil, nil, nil, err
		}
		if exact {
			states[id], found[id], evidence[id] = value.state, true, value.provenance
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, nil, err
	}
	return states, found, evidence, nil
}

type operationalCacheKey struct {
	target int
	pool   string
}

type operationalCacheEntry struct {
	provenance OperationalProvenance
	state      spk.State
	found      bool
	err        error
}

func (c *Catalog) operationalRoot(ctx context.Context, target int, et float64) (*kernelBinding, error) {
	return c.operationalRootCached(ctx, target, et, nil)
}

type rawEvaluationKey struct {
	binding *kernelBinding
	target  int
}

func evaluateBinding(ctx context.Context, binding *kernelBinding, kernel *spk.Kernel, target int, et float64, raw map[rawEvaluationKey]operationalCacheEntry) (spk.State, bool, error) {
	if err := ctx.Err(); err != nil {
		return spk.State{}, false, err
	}
	key := rawEvaluationKey{binding, target}
	if cached, ok := raw[key]; ok {
		return cached.state, cached.found, cached.err
	}
	state, found, err := kernel.EvaluateContext(ctx, target, et)
	if raw != nil {
		raw[key] = operationalCacheEntry{state: state, found: found, err: err}
	}
	return state, found, err
}

func bindingProvenance(binding *kernelBinding, target int, et float64, center, frame int) OperationalProvenance {
	start, end := binding.startET, binding.endET
	segmentType := 0
	for n := len(binding.kernel.Segments) - 1; n >= 0; n-- {
		segment := binding.kernel.Segments[n]
		if segment.Target == target && segment.Center == center && segment.Frame == frame && et >= segment.StartET && et <= segment.EndET {
			start, end = segment.StartET, segment.EndET
			segmentType = segment.Type
			break
		}
	}
	return OperationalProvenance{Source: binding.id, KernelSHA256: binding.sha256, CenterID: "naif:" + strconv.Itoa(center), SegmentFrame: frame, SegmentType: segmentType, ValidityStartET: start, ValidityEndET: end, ValidityPresent: validFloat(start) && validFloat(end) && end >= start}
}

func (c *Catalog) operationalRootCached(ctx context.Context, target int, et float64, raw map[rawEvaluationKey]operationalCacheEntry) (*kernelBinding, error) {
	for n := len(c.byTarget[target]) - 1; n >= 0; n-- {
		candidate := c.byTarget[target][n]
		if candidate.dependencyOnly {
			continue
		}
		kernel, err := candidate.kernelFor(ctx, c.kernelCacheBudgetForBinding())
		if err != nil {
			if ctx.Err() != nil {
				return nil, err
			}
			// A corrupt or structurally invalid candidate cannot provide an
			// exact state. Continue looking for an older valid covering file;
			// if none exists, the caller will report a missing state.
			continue
		}
		if _, found, err := evaluateBinding(ctx, candidate, kernel, target, et, raw); err != nil {
			return nil, err
		} else if found {
			return candidate, nil
		}
	}
	return nil, nil
}

type operationalSourcePool struct {
	bindings []*kernelBinding // Declaration order, followed by the root last.
}

func (c *Catalog) operationalPool(root *kernelBinding) (*operationalSourcePool, string, bool, error) {
	if !root.explicitPool {
		return nil, "", true, nil
	}
	allowed := &operationalSourcePool{bindings: make([]*kernelBinding, 0, len(root.solutionIDs)+1)}
	seen := map[string]bool{root.id: true}
	complete := true
	for _, id := range root.solutionIDs {
		if seen[id] || id == "" {
			return nil, "", false, fmt.Errorf("invalid explicit SPK dependency pool for %s", root.id)
		}
		seen[id] = true
		dependency := c.kernels[id]
		if dependency == nil {
			complete = false
		} else {
			allowed.bindings = append(allowed.bindings, dependency)
		}
	}
	allowed.bindings = append(allowed.bindings, root)
	identity, err := json.Marshal(append([]string{root.id}, root.solutionIDs...))
	return allowed, string(identity), complete, err
}

func (c *Catalog) resolveOperationalCached(ctx context.Context, target int, et float64, allowed *operationalSourcePool, pool string, cache map[operationalCacheKey]operationalCacheEntry, visiting map[int]bool) (spk.State, bool, error) {
	return c.resolveOperationalSession(ctx, target, et, allowed, pool, cache, visiting, nil)
}

func (c *Catalog) resolveOperationalSession(ctx context.Context, target int, et float64, allowed *operationalSourcePool, pool string, cache map[operationalCacheKey]operationalCacheEntry, visiting map[int]bool, raw map[rawEvaluationKey]operationalCacheEntry) (spk.State, bool, error) {
	if err := ctx.Err(); err != nil {
		return spk.State{}, false, err
	}
	key := operationalCacheKey{target: target, pool: pool}
	if cache != nil {
		if entry, ok := cache[key]; ok {
			return entry.state, entry.found, entry.err
		}
	}
	if target == 0 {
		st := spk.State{Center: 0, Frame: 17}
		if cache != nil {
			cache[key] = operationalCacheEntry{state: st, found: true, provenance: OperationalProvenance{SourceChainSHA256: hex.EncodeToString(sourceChainOrigin[:])}}
		}
		return st, true, nil
	}
	if visiting[target] {
		err := fmt.Errorf("cyclic SPK center chain")
		if cache != nil {
			cache[key] = operationalCacheEntry{err: err}
		}
		return spk.State{}, false, err
	}
	visiting[target] = true
	defer delete(visiting, target)
	bindings := c.byTarget[target]
	if allowed != nil {
		bindings = allowed.bindings
	}
	for n := len(bindings) - 1; n >= 0; n-- {
		binding := bindings[n]
		if allowed == nil && (binding.dependencyOnly || binding.explicitPool) {
			continue
		}
		kernel, err := binding.kernelFor(ctx, c.kernelCacheBudgetForBinding())
		if err != nil {
			if ctx.Err() == nil && allowed == nil {
				continue
			}
			if cache != nil {
				cache[key] = operationalCacheEntry{err: err}
			}
			return spk.State{}, false, err
		}
		st, found, err := evaluateBinding(ctx, binding, kernel, target, et, raw)
		if err != nil {
			if cache != nil {
				cache[key] = operationalCacheEntry{err: err}
			}
			return spk.State{}, false, err
		}
		if !found {
			continue
		}
		center, centerFound, err := c.resolveOperationalSession(ctx, st.Center, et, allowed, pool, cache, visiting, raw)
		if err != nil {
			if cache != nil {
				cache[key] = operationalCacheEntry{err: err}
			}
			return spk.State{}, false, err
		}
		if !centerFound {
			if cache != nil {
				cache[key] = operationalCacheEntry{}
			}
			return spk.State{}, false, nil
		}
		sourceFrame := st.Frame
		st.Position = addSPK(center.Position, convertFrame(st.Position, st.Frame))
		st.Velocity = addSPK(center.Velocity, convertFrame(st.Velocity, st.Frame))
		st.Frame = 17
		if cache != nil {
			provenance := bindingProvenance(binding, target, et, st.Center, sourceFrame)
			parent := cache[operationalCacheKey{target: st.Center, pool: pool}].provenance.SourceChainSHA256
			if parent == "" {
				return spk.State{}, false, fmt.Errorf("SPK center-chain provenance unavailable")
			}
			// Hash the actual selected segment and recursively selected center,
			// not merely the set of files permitted in this source context.
			provenance.SourceChainSHA256, err = sourceChainSegmentSHA256(provenance.Source, provenance.KernelSHA256,
				target, st.Center, sourceFrame, provenance.SegmentType, provenance.ValidityStartET, provenance.ValidityEndET, parent)
			if err != nil {
				return spk.State{}, false, err
			}
			cache[key] = operationalCacheEntry{state: st, found: true, provenance: provenance}
		}
		return st, true, nil
	}
	if cache != nil {
		cache[key] = operationalCacheEntry{}
	}
	return spk.State{}, false, nil
}

func (c *Catalog) resolveOperational(target int, et float64, allowed *operationalSourcePool, visiting map[int]bool) (spk.State, bool, error) {
	st, found, err := c.resolveOperationalCached(context.Background(), target, et, allowed, "", nil, visiting)
	if found {
		st.Center = 0
	}
	return st, found, err
}
func convertFrame(v spk.Vec3, frame int) spk.Vec3 {
	if frame == 17 {
		return v
	}
	if frame != 1 {
		return spk.Vec3{X: math.NaN(), Y: math.NaN(), Z: math.NaN()}
	}
	const eps = 84381.448 / 3600 * math.Pi / 180
	return spk.Vec3{X: v.X, Y: math.Cos(eps)*v.Y + math.Sin(eps)*v.Z, Z: -math.Sin(eps)*v.Y + math.Cos(eps)*v.Z}
}
func toEcliptic(v spk.Vec3, frame int) Vec3 {
	x := convertFrame(v, frame)
	return Vec3{X: x.X, Y: x.Y, Z: x.Z}
}
func addSPK(a, b spk.Vec3) spk.Vec3 { return spk.Vec3{X: a.X + b.X, Y: a.Y + b.Y, Z: a.Z + b.Z} }

func fromEphemeris(x struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ShortName string `json:"shortName"`
	Kind      string `json:"kind"`
	NAIFID    int    `json:"naifId"`
	ParentID  string `json:"parentId"`
	Source    string `json:"source"`
	Orbit     struct {
		Model               string  `json:"model"`
		EpochJD             float64 `json:"epochJd"`
		SemiMajorAxisAU     float64 `json:"semiMajorAxisAU"`
		Eccentricity        float64 `json:"eccentricity"`
		InclinationDeg      float64 `json:"inclinationDeg"`
		AscendingNodeDeg    float64 `json:"ascendingNodeDeg"`
		ArgPeriapsisDeg     float64 `json:"argPeriapsisDeg"`
		MeanAnomalyDeg      float64 `json:"meanAnomalyDeg"`
		MeanMotionDegPerDay float64 `json:"meanMotionDegPerDay"`
	} `json:"orbit"`
	ParentRelativeStateKm *struct {
		Position Vec3 `json:"position"`
		Velocity Vec3 `json:"velocity"`
	} `json:"parentRelativeStateKm"`
}, version string, defaultEpoch float64) Body {
	e := &Elements{SemiMajorAxisAU: x.Orbit.SemiMajorAxisAU, Eccentricity: x.Orbit.Eccentricity, InclinationDeg: x.Orbit.InclinationDeg, AscendingNodeDeg: x.Orbit.AscendingNodeDeg, ArgPeriapsisDeg: x.Orbit.ArgPeriapsisDeg, MeanAnomalyDeg: x.Orbit.MeanAnomalyDeg, MeanMotionDegPerDay: x.Orbit.MeanMotionDegPerDay}
	b := Body{ID: x.ID, NAIFID: x.NAIFID, Name: x.Name, Kind: x.Kind, ParentID: x.ParentID, Source: x.Source, DatasetVersion: version, Availability: AvailableFallback, EpochJD: x.Orbit.EpochJD, EpochTimeScale: "TDB", ReferenceFrame: "ECLIPJ2000", Model: "fixed-osculating-two-body", Elements: e}
	if b.EpochJD == 0 {
		b.EpochJD = defaultEpoch
	}
	if x.ParentRelativeStateKm != nil {
		b.InitialState = &State{Position: x.ParentRelativeStateKm.Position, Velocity: x.ParentRelativeStateKm.Velocity}
	}
	return b
}

func builtins() []Body {
	// The same JPL coefficients drive both metadata and the secular evaluator.
	type seed struct {
		id   string
		naif int
		name string
	}
	ss := []seed{{"sun", 10, "Sun"}, {"mercury", 199, "Mercury"}, {"venus", 299, "Venus"}, {"earth", 399, "Earth"}, {"mars", 499, "Mars"}, {"jupiter", 599, "Jupiter"}, {"saturn", 699, "Saturn"}, {"uranus", 799, "Uranus"}, {"neptune", 899, "Neptune"}, {"pluto", 999, "Pluto"}}
	out := make([]Body, 0, len(ss))
	for _, s := range ss {
		b := Body{ID: s.id, NAIFID: s.naif, Name: s.name, Kind: "planet", ParentID: "sun", Source: "jpl-approx-table-1", DatasetVersion: "builtin-jpl-approx-table-1", Availability: AvailableFallback, ValidityStartET: (science.PlanetaryStartJD - 2451545) * 86400, ValidityEndET: (science.PlanetaryEndJD - 2451545) * 86400, EpochJD: 2451545, EpochTimeScale: "TDB", ReferenceFrame: "ECLIPJ2000", Model: "jpl-approx-keplerian-secular"}
		if e, ok := science.PlanetaryEpochElements(s.naif); ok {
			b.Elements = &Elements{e.SemiMajorAxisAU, e.Eccentricity, e.InclinationDeg, e.AscendingNodeDeg, e.ArgPeriapsisDeg, e.MeanAnomalyDeg, e.MeanMotionDegPerDay}
		}
		if b.Kind == "" {
			b.Kind = "planet"
		}
		if s.id == "sun" {
			b.Model = "fixed-origin"
			b.Kind = "star"
			b.ParentID = ""
			b.Source = "heliocentric-origin"
		}
		if s.id == "earth" {
			b.Model = "jpl-approx-keplerian-secular-earth-moon-partition"
			b.PositionRepresents = "earth-geocenter"
		}
		if s.id == "pluto" {
			// The current cited Table 1 has no Pluto row. Retain its identity,
			// but require packaged SPK or sourced epoch elements for a state.
			b.Kind = "dwarfPlanet"
			b.Availability = Missing
			b.MissingReason = "no-supported-state-model"
			b.Model = "exact-only"
			b.Source = "naif-identity"
		}
		out = append(out, b)
	}
	// Identity-only spacecraft: no schematic scene points or Kepler fallback.
	// Keep these mappings aligned with src/data/spacecraftIdentities.ts and
	// the cited NAIF identity table; kernel presence is checked independently.
	for _, s := range []seed{{"voyager1", -31, "Voyager 1"}, {"voyager2", -32, "Voyager 2"}, {"newhorizons", -98, "New Horizons"}} {
		b := Body{ID: s.id, NAIFID: s.naif, Name: s.name, Kind: "spacecraft",
			Source: "naif-identity", SourceURL: "https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/naif_ids.html",
			DatasetVersion: "builtin-naif-spacecraft-identities-v1", IdentityStatus: "source-designation",
			Availability: Missing, MissingReason: "kernel-not-packaged", Model: "exact-only",
			Provenance: "Reviewed spacecraft identity; no trajectory is implied by this record."}
		out = append(out, b)
		b.ID = "naif:" + strconv.Itoa(s.naif)
		out = append(out, b)
	}
	return out
}

func validFloat(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
