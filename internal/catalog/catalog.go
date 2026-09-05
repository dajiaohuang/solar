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

// Kept as a narrow seam for the lifecycle regression test. Production code
// always uses the SPK package implementation.
var openKernelWithCache = spk.OpenWithCache

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
			binding = &kernelBinding{id: f.ID, sha256: f.SHA256, path: kernelPath, bytes: f.Bytes, startET: f.StartET, endET: f.EndET, dependencyOnly: f.DependencyOnly, solutionIDs: append([]string(nil), f.SolutionKernelIDs...)}
			c.kernels[f.ID] = binding
			c.packagedFiles++
			for _, target := range f.Targets {
				c.byTarget[target] = append(c.byTarget[target], binding)
			}
		}
		for _, naif := range f.Targets {
			id := "naif:" + strconv.Itoa(naif)
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
		if b.NAIFID != 0 && len(c.byTarget[b.NAIFID]) > 0 {
			b.Availability = AvailableOperational
			b.MissingReason = ""
			b.Model = "spk-original"
			c.byID[id] = b
		}
	}
	c.rebuild()
	return c, nil
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

func verifyManifestPathContext(ctx context.Context, path string, file manifestFile) (bool, int64, error) {
	if !validManifestIdentity(file) {
		return false, 0, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	f, err := os.Open(path)
	if err != nil {
		return false, 0, err
	}
	defer f.Close()
	h := sha256.New()
	buf := make([]byte, 1<<20)
	var n int64
	for {
		if err := ctx.Err(); err != nil {
			return false, n, err
		}
		read, readErr := f.Read(buf)
		if read > 0 {
			if _, err := h.Write(buf[:read]); err != nil {
				return false, n, err
			}
			n += int64(read)
			if n > file.Bytes {
				return false, n, nil
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return false, n, readErr
		}
	}
	if n != file.Bytes {
		return false, n, nil
	}
	digest := strings.TrimSpace(file.SHA256)
	return strings.EqualFold(hex.EncodeToString(h.Sum(nil)), digest), n, nil
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

		verified, integrityBytes, err := verifyManifestPathContext(ctx, b.path, manifestFile{SHA256: b.sha256, Bytes: b.bytes})
		if err == nil && !verified {
			err = fmt.Errorf("kernel %s failed manifest integrity verification", b.id)
		}
		var kernel *spk.Kernel
		if err == nil {
			kernel, err = openKernelWithCache(b.path, spk.DefaultPageSize, pageCacheBytes)
		}

		b.mu.Lock()
		b.loading = false
		b.integrityReads++
		b.integrityBytes += integrityBytes
		closed := b.closed
		if err == nil && closed {
			err = errCatalogClosed
		}
		if err == nil {
			b.kernel = kernel
			b.verified = true
		} else if !closed && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			b.terminalErr = err
		}
		if closed && kernel != nil {
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
			// The current-states endpoint is exact-only; fallback catalog
			// elements are not an identity it can emit.
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
	Source          string
	KernelSHA256    string
	CenterID        string
	ValidityStartET float64
	ValidityEndET   float64
	ValidityPresent bool
}

func (c *Catalog) OperationalProvenance(id string, jd float64) (OperationalProvenance, bool, error) {
	b, ok := c.byID[id]
	if !ok || b.NAIFID == 0 || !validFloat(jd) {
		return OperationalProvenance{}, false, nil
	}
	et := (jd - 2451545.0) * 86400
	root, err := c.operationalRoot(context.Background(), b.NAIFID, et)
	if err != nil || root == nil {
		return OperationalProvenance{}, false, err
	}
	state, found, err := root.kernel.Evaluate(b.NAIFID, et)
	if err != nil || !found || root.id == "" || root.sha256 == "" {
		return OperationalProvenance{}, false, err
	}
	start, end := root.startET, root.endET
	for n := len(root.kernel.Segments) - 1; n >= 0; n-- {
		segment := root.kernel.Segments[n]
		if segment.Target == b.NAIFID && et >= segment.StartET && et <= segment.EndET {
			start, end = segment.StartET, segment.EndET
			break
		}
	}
	return OperationalProvenance{
		Source:          root.id,
		KernelSHA256:    root.sha256,
		CenterID:        "naif:" + strconv.Itoa(state.Center),
		ValidityStartET: start,
		ValidityEndET:   end,
		ValidityPresent: validFloat(start) && validFloat(end) && end >= start,
	}, true, nil
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
	states := make(map[string]State, len(ids))
	found := make(map[string]bool, len(ids))
	if !validFloat(jd) || len(c.byTarget) == 0 {
		return states, found, nil
	}
	et := (jd - 2451545.0) * 86400
	cache := make(map[operationalCacheKey]operationalCacheEntry, len(ids)*2)
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		b, ok := c.byID[id]
		if !ok || b.NAIFID == 0 {
			continue
		}
		root, err := c.operationalRoot(ctx, b.NAIFID, et)
		if err != nil {
			return nil, nil, err
		}
		if root == nil {
			continue
		}
		allowed, pool := operationalPool(root)
		st, ok, err := c.resolveOperationalCached(ctx, b.NAIFID, et, allowed, pool, cache, map[int]bool{})
		if err != nil {
			return nil, nil, err
		}
		if ok {
			states[id] = State{Position: toEcliptic(st.Position, st.Frame), Velocity: toEcliptic(st.Velocity, st.Frame)}
			found[id] = true
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	return states, found, nil
}

type operationalCacheKey struct {
	target int
	pool   string
}

type operationalCacheEntry struct {
	state spk.State
	found bool
	err   error
}

func (c *Catalog) operationalRoot(ctx context.Context, target int, et float64) (*kernelBinding, error) {
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
		if _, found, err := kernel.Evaluate(target, et); err != nil {
			return nil, err
		} else if found {
			return candidate, nil
		}
	}
	return nil, nil
}

func operationalPool(root *kernelBinding) (map[string]bool, string) {
	if len(root.solutionIDs) == 0 {
		return nil, ""
	}
	allowed := make(map[string]bool, len(root.solutionIDs)+1)
	for _, id := range root.solutionIDs {
		allowed[id] = true
	}
	allowed[root.id] = true
	return allowed, root.id + "\x00" + strings.Join(root.solutionIDs, "\x00")
}

func (c *Catalog) resolveOperationalCached(ctx context.Context, target int, et float64, allowed map[string]bool, pool string, cache map[operationalCacheKey]operationalCacheEntry, visiting map[int]bool) (spk.State, bool, error) {
	key := operationalCacheKey{target: target, pool: pool}
	if cache != nil {
		if entry, ok := cache[key]; ok {
			return entry.state, entry.found, entry.err
		}
	}
	if target == 0 {
		st := spk.State{Center: 0, Frame: 17}
		if cache != nil {
			cache[key] = operationalCacheEntry{state: st, found: true}
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
	for n := len(c.byTarget[target]) - 1; n >= 0; n-- {
		binding := c.byTarget[target][n]
		if allowed != nil {
			if !allowed[binding.id] {
				continue
			}
		} else if binding.dependencyOnly {
			continue
		}
		kernel, err := binding.kernelFor(ctx, c.kernelCacheBudgetForBinding())
		if err != nil {
			if ctx.Err() == nil {
				continue
			}
			if cache != nil {
				cache[key] = operationalCacheEntry{err: err}
			}
			return spk.State{}, false, err
		}
		st, found, err := kernel.Evaluate(target, et)
		if err != nil {
			if cache != nil {
				cache[key] = operationalCacheEntry{err: err}
			}
			return spk.State{}, false, err
		}
		if !found {
			continue
		}
		center, centerFound, err := c.resolveOperationalCached(ctx, st.Center, et, allowed, pool, cache, visiting)
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
		st.Position = addSPK(center.Position, convertFrame(st.Position, st.Frame))
		st.Velocity = addSPK(center.Velocity, convertFrame(st.Velocity, st.Frame))
		st.Frame = 17
		if cache != nil {
			cache[key] = operationalCacheEntry{state: st, found: true}
		}
		return st, true, nil
	}
	if cache != nil {
		cache[key] = operationalCacheEntry{}
	}
	return spk.State{}, false, nil
}

func (c *Catalog) resolveOperational(target int, et float64, allowed map[string]bool, visiting map[int]bool) (spk.State, bool, error) {
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
	// JPL approximate-position table seeds; the validity and approximation are explicit.
	type seed struct {
		id                       string
		naif                     int
		name                     string
		a, e, i, node, arg, m, n float64
	}
	ss := []seed{{"sun", 10, "Sun", 0, 0, 0, 0, 0, 0, 0}, {"mercury", 199, "Mercury", .38709927, .20563593, 7.00497902, 48.33076593, 29.12703035, 223.12329315, 4.09233445}, {"venus", 299, "Venus", .72333566, .00677672, 3.39467605, 76.67984255, 54.92262463, 127.056475, 1.60213034}, {"earth", 399, "Earth", 1.00000261, .01671123, -.00001531, 0, 102.93768193, -2.47311027, .98560767}, {"mars", 499, "Mars", 1.52371034, .0933941, 1.84969142, 49.55953891, 73.6160585, 19.373, .52402078}, {"jupiter", 599, "Jupiter", 5.202887, .04838624, 1.30439695, 100.47390909, 14.72847983, 19.667, .0830853}, {"saturn", 699, "Saturn", 9.53667594, .05386179, 2.48599187, 113.66242448, -21.064, 317.02, .0334442}, {"uranus", 799, "Uranus", 19.18916464, .04725744, .77263783, 74.01692503, 96.541318, 142.2386, .0117258}, {"neptune", 899, "Neptune", 30.06992276, .00859048, 1.77004347, 131.78422574, -86.75034, 256.228, .0059811}, {"pluto", 999, "Pluto", 39.482, .2488, 17.14, 110.3, 113.8, 14.5, .00396}}
	out := make([]Body, 0, len(ss))
	for _, s := range ss {
		b := Body{ID: s.id, NAIFID: s.naif, Name: s.name, Kind: map[string]string{"sun": "star"}[s.id], Source: "jpl-approx-table-1", DatasetVersion: "builtin-jpl-approx-table-1", Availability: AvailableFallback, ValidityStartET: -6311390400, ValidityEndET: 1609459200, EpochJD: 2451545, EpochTimeScale: "TDB", ReferenceFrame: "ECLIPJ2000", Model: "jpl-approx-keplerian-secular", Elements: &Elements{SemiMajorAxisAU: s.a, Eccentricity: s.e, InclinationDeg: s.i, AscendingNodeDeg: s.node, ArgPeriapsisDeg: s.arg, MeanAnomalyDeg: s.m, MeanMotionDegPerDay: s.n}}
		if b.Kind == "" {
			b.Kind = "planet"
		}
		if s.id == "sun" {
			b.Model = "fixed-origin"
		}
		out = append(out, b)
	}
	return out
}

func validFloat(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
