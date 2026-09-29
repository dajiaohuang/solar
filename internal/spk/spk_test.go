package spk

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"math"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestType17MatchesIndependentCSPICEOracle(t *testing.T) {
	oracleBytes, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk17-cspice.json"))
	if err != nil {
		t.Fatal(err)
	}
	var oracle struct {
		Elements []float64 `json:"elements"`
		Samples  []struct {
			ET    float64   `json:"et"`
			State []float64 `json:"state"`
		} `json:"samples"`
	}
	if err := json.Unmarshal(oracleBytes, &oracle); err != nil {
		t.Fatal(err)
	}
	if len(oracle.Elements) != 12 || len(oracle.Samples) == 0 {
		t.Fatal("invalid CSPICE type 17 oracle fixture")
	}
	b := make([]byte, 12*8)
	for i, v := range oracle.Elements {
		binary.LittleEndian.PutUint64(b[i*8:], math.Float64bits(v))
	}
	k := &Kernel{data: b, little: true}
	seg := Segment{Type: 17, Start: 1, End: 12, type17: true}
	for _, sample := range oracle.Samples {
		if len(sample.State) != 6 {
			t.Fatal("invalid CSPICE state fixture")
		}
		got, err := k.eval17(seg, sample.ET)
		if err != nil {
			t.Fatal(err)
		}
		for i, want := range sample.State {
			if math.Abs(got[i]-want) > 1e-9*math.Max(1, math.Abs(want)) {
				t.Fatalf("et %v component %d got %.17g want %.17g", sample.ET, i, got[i], want)
			}
		}
	}
}

func TestSyntheticType21MatchesCSPICEFixture(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	k, err := New(b)
	if err != nil {
		t.Fatal(err)
	}
	s, ok, err := k.Evaluate(-210001, 0)
	if err != nil || !ok {
		t.Fatalf("evaluate: ok=%v err=%v", ok, err)
	}
	want := [6]float64{99999950.079648256, 199999900.15929651, 299999850.23894477, 0.12460263522648826, 0.24920527045297652, 0.37380790567946476}
	got := [6]float64{s.Position.X, s.Position.Y, s.Position.Z, s.Velocity.X, s.Velocity.Y, s.Velocity.Z}
	for i := range want {
		if math.Abs(got[i]-want[i]) > 1e-8*math.Max(1, math.Abs(want[i])) {
			t.Fatalf("component %d got %.17g want %.17g", i, got[i], want[i])
		}
	}
	if s.Center != 0 || s.Frame != 1 || len(k.Segments) == 0 || k.Segments[0].Type != 21 {
		t.Fatalf("unexpected segment: %+v", s)
	}
}

func TestOpenUsesBoundedLazyReaderAt(t *testing.T) {
	path := filepath.Join("..", "..", "tests", "fixtures", "spk21-synthetic.bsp")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	k, err := OpenWithCache(path, 4096, 16<<10)
	if err != nil {
		t.Fatal(err)
	}
	defer k.Close()
	if k.data != nil || k.source == nil {
		t.Fatal("file-backed kernel retained an in-memory file image")
	}
	opened := k.ReadStats()
	if opened.CachedBytes > opened.MaxBytes || opened.LoadedBytes >= info.Size() {
		t.Fatalf("metadata parse was not lazy/bounded: %+v fileBytes=%d", opened, info.Size())
	}
	state, found, err := k.Evaluate(-210001, 0)
	if err != nil || !found || state.Position.X < 99999949 || state.Position.X > 99999951 {
		t.Fatalf("lazy evaluate: found=%v err=%v state=%+v", found, err, state)
	}
	evaluated := k.ReadStats()
	if evaluated.CachedBytes > evaluated.MaxBytes || evaluated.LoadedBytes <= opened.LoadedBytes {
		t.Fatalf("evaluation did not load bounded pages: %+v opened=%+v", evaluated, opened)
	}
	if _, found, err := k.Evaluate(-210001, 0); err != nil || !found {
		t.Fatalf("repeat lazy evaluate: found=%v err=%v", found, err)
	}
	repeated := k.ReadStats()
	if repeated.CacheHits <= evaluated.CacheHits {
		t.Fatalf("repeat evaluation did not reuse page cache: evaluated=%+v repeated=%+v", evaluated, repeated)
	}
}

type gatedPageReader struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
	mu      sync.Mutex
	reads   int
}

func (r *gatedPageReader) ReadAt(dst []byte, _ int64) (int, error) {
	r.mu.Lock()
	r.reads++
	r.mu.Unlock()
	r.once.Do(func() { close(r.started) })
	<-r.release
	for i := range dst {
		dst[i] = 0x5a
	}
	return len(dst), nil
}

func TestConcurrentPageReadsCoalesce(t *testing.T) {
	const readers = 8
	reader := &gatedPageReader{started: make(chan struct{}), release: make(chan struct{})}
	source := newPageSource(reader, 1024, nil, 1024, 1024)
	results := make(chan error, readers)
	for range readers {
		go func() {
			data, err := source.pageData(0)
			if err == nil && (len(data) != 1024 || data[0] != 0x5a || data[len(data)-1] != 0x5a) {
				err = io.ErrUnexpectedEOF
			}
			results <- err
		}()
	}
	<-reader.started
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	for {
		source.mu.Lock()
		misses := source.stats.CacheMisses
		source.mu.Unlock()
		if misses == readers {
			break
		}
		select {
		case <-deadline.C:
			close(reader.release)
			t.Fatalf("only %d concurrent readers reached the page flight", misses)
		case <-time.After(time.Millisecond):
		}
	}
	close(reader.release)
	for range readers {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	reader.mu.Lock()
	reads := reader.reads
	reader.mu.Unlock()
	stats := source.Stats()
	if reads != 1 || stats.PageLoads != 1 || stats.LoadedBytes != 1024 {
		t.Fatalf("same-page misses were not coalesced: reads=%d stats=%+v", reads, stats)
	}
}

func TestRejectsMalformedSPK(t *testing.T) {
	if _, err := New(make([]byte, 3072)); err == nil {
		t.Fatal("expected malformed header rejection")
	}
}

func TestRepositorySPKFixturesParse(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "..", "tests", "fixtures", "*.bsp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatal("no SPK fixtures found")
	}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := New(raw); err != nil {
			t.Errorf("%s: %v", filepath.Base(path), err)
		}
	}
}

func FuzzSPKParserNeverPanics(f *testing.F) {
	for _, seed := range [][]byte{nil, make([]byte, 3072), []byte("DAF/SPK")} {
		f.Add(seed)
	}
	f.Fuzz(func(_ *testing.T, data []byte) {
		_, _ = New(data)
	})
}
