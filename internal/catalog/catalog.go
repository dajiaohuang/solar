package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/dajiaohuang/solar/backend/internal/spk"
)

const APIVersion = "solar.api/v1"

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
	bodies           []Body
	byID             map[string]Body
	version          string
	manifestHash     string
	manifestProfile  string
	manifestContract string
	manifestFiles    int
	manifestTargets  int
	packagedFiles    int
	kernels          map[string]*kernelBinding
	byTarget         map[int][]*kernelBinding
}

type kernelBinding struct {
	id             string
	kernel         *spk.Kernel
	dependencyOnly bool
	solutionIDs    []string
}

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
	h := sha256.Sum256(mb)
	c := &Catalog{byID: make(map[string]Body), kernels: make(map[string]*kernelBinding), byTarget: make(map[int][]*kernelBinding), version: m.ID, manifestHash: hex.EncodeToString(h[:]), manifestProfile: m.Profile, manifestContract: m.Contract, manifestFiles: len(m.Files)}
	manifestTargetIDs := make(map[int]struct{})
	// Keep stable, well-known body identities available even without the large kernels.
	for _, b := range builtins() {
		c.add(b)
	}
	for _, f := range m.Files {
		for _, target := range f.Targets {
			manifestTargetIDs[target] = struct{}{}
		}
		present := fileExists(filepath.Join(dataDir, f.Path))
		var binding *kernelBinding
		if present {
			if raw, readErr := os.ReadFile(filepath.Join(dataDir, f.Path)); readErr == nil {
				if k, parseErr := spk.New(raw); parseErr == nil {
					binding = &kernelBinding{id: f.ID, kernel: k, dependencyOnly: f.DependencyOnly, solutionIDs: append([]string(nil), f.SolutionKernelIDs...)}
					c.kernels[f.ID] = binding
					c.packagedFiles++
					for _, target := range f.Targets {
						c.byTarget[target] = append(c.byTarget[target], binding)
					}
				}
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
				b.MissingReason = "kernel-invalid"
			} else if b.Availability != AvailableFallback {
				b.Availability = Missing
				b.MissingReason = "kernel-not-packaged"
			}
			b.DatasetVersion = m.ID
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
func (c *Catalog) Stats() map[string]int {
	out := map[string]int{"catalogEntries": len(c.bodies), "manifestFiles": c.manifestFiles, "manifestTargets": c.manifestTargets, "packagedFiles": c.packagedFiles}
	for _, b := range c.bodies {
		out[string(b.Availability)]++
	}
	return out
}

func (c *Catalog) AuditIdentityTuples() []map[string]string {
	type identity struct{ source, datasetVersion, model string }
	seen := make(map[identity]struct{})
	for _, body := range c.bodies {
		if body.Source == "" || body.DatasetVersion == "" || body.Model == "" {
			continue
		}
		seen[identity{body.Source, body.DatasetVersion, body.Model}] = struct{}{}
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
	states := make(map[string]State, len(ids))
	found := make(map[string]bool, len(ids))
	if !validFloat(jd) || len(c.byTarget) == 0 {
		return states, found, nil
	}
	et := (jd - 2451545.0) * 86400
	cache := make(map[operationalCacheKey]operationalCacheEntry, len(ids)*2)
	for _, id := range ids {
		b, ok := c.byID[id]
		if !ok || b.NAIFID == 0 {
			continue
		}
		root, err := c.operationalRoot(b.NAIFID, et)
		if err != nil {
			return nil, nil, err
		}
		if root == nil {
			continue
		}
		allowed, pool := operationalPool(root)
		st, ok, err := c.resolveOperationalCached(b.NAIFID, et, allowed, pool, cache, map[int]bool{})
		if err != nil {
			return nil, nil, err
		}
		if ok {
			states[id] = State{Position: toEcliptic(st.Position, st.Frame), Velocity: toEcliptic(st.Velocity, st.Frame)}
			found[id] = true
		}
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

func (c *Catalog) operationalRoot(target int, et float64) (*kernelBinding, error) {
	for n := len(c.byTarget[target]) - 1; n >= 0; n-- {
		candidate := c.byTarget[target][n]
		if candidate.dependencyOnly {
			continue
		}
		if _, found, err := candidate.kernel.Evaluate(target, et); err != nil {
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

func (c *Catalog) resolveOperationalCached(target int, et float64, allowed map[string]bool, pool string, cache map[operationalCacheKey]operationalCacheEntry, visiting map[int]bool) (spk.State, bool, error) {
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
		st, found, err := binding.kernel.Evaluate(target, et)
		if err != nil {
			if cache != nil {
				cache[key] = operationalCacheEntry{err: err}
			}
			return spk.State{}, false, err
		}
		if !found {
			continue
		}
		center, centerFound, err := c.resolveOperationalCached(st.Center, et, allowed, pool, cache, visiting)
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
	st, found, err := c.resolveOperationalCached(target, et, allowed, "", nil, visiting)
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
