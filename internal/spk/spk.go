// Package spk implements the bounded, read-only subset of NAIF DAF/SPK used
// by Solar Atlas. It evaluates original type 2/3/17/21 records; it does not
// fit, integrate or synthesize an orbit.
package spk

import (
	"container/list"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"sync"
)

type Vec3 struct{ X, Y, Z float64 }
type State struct {
	Position, Velocity Vec3
	Center, Frame      int
}
type Segment struct {
	Target, Center, Frame, Type       int
	StartET, EndET                    float64
	Start, End                        int
	Coefficients, Records, RecordSize int
	type17                            bool
	type21                            *type21Meta
}
type type21Meta struct{ Dimension, RecordSize, Records, Epochs int }

const recordBytes = 1024

const (
	DefaultPageSize      = 64 << 10
	DefaultCacheBytes    = 4 << 20
	minimumPageSize      = 1024
	minimumCachePageSize = 1
)

type ReadStats struct {
	PageSize    int
	MaxBytes    int64
	CachedBytes int64
	LoadedBytes int64
	PageLoads   uint64
	CacheHits   uint64
	CacheMisses uint64
}

type pageSource struct {
	reader io.ReaderAt
	size   int64
	close  io.Closer
	page   int64
	max    int64
	mu     sync.Mutex
	items  map[int64]*list.Element
	order  *list.List
	bytes  int64
	stats  ReadStats
}

type pageEntry struct {
	index int64
	data  []byte
}

func newPageSource(reader io.ReaderAt, size int64, closer io.Closer, pageSize int, maxBytes int64) *pageSource {
	if pageSize < minimumPageSize {
		pageSize = minimumPageSize
	}
	if maxBytes < int64(pageSize*minimumCachePageSize) {
		maxBytes = int64(pageSize * minimumCachePageSize)
	}
	return &pageSource{reader: reader, size: size, close: closer, page: int64(pageSize), max: maxBytes, items: make(map[int64]*list.Element), order: list.New(), stats: ReadStats{PageSize: pageSize, MaxBytes: maxBytes}}
}

func (p *pageSource) ReadAt(dst []byte, off int64) (int, error) {
	if off < 0 || off >= p.size && len(dst) > 0 {
		return 0, io.EOF
	}
	read := 0
	for read < len(dst) {
		pos := off + int64(read)
		index := pos / p.page
		within := int(pos % p.page)
		data, err := p.pageData(index)
		if err != nil {
			return read, err
		}
		if within >= len(data) {
			return read, io.EOF
		}
		count := len(data) - within
		if count > len(dst)-read {
			count = len(dst) - read
		}
		copy(dst[read:read+count], data[within:within+count])
		read += count
	}
	if read != len(dst) {
		return read, io.EOF
	}
	return read, nil
}

func (p *pageSource) pageData(index int64) ([]byte, error) {
	p.mu.Lock()
	if element := p.items[index]; element != nil {
		p.order.MoveToFront(element)
		p.stats.CacheHits++
		data := element.Value.(*pageEntry).data
		p.mu.Unlock()
		return data, nil
	}
	p.stats.CacheMisses++
	p.mu.Unlock()
	start := index * p.page
	length := p.page
	if remaining := p.size - start; remaining < length {
		length = remaining
	}
	if length <= 0 {
		return nil, io.EOF
	}
	data := make([]byte, int(length))
	n, err := p.reader.ReadAt(data, start)
	if err != nil && err != io.EOF {
		return nil, err
	}
	data = data[:n]
	p.mu.Lock()
	// Another reader may have populated this page while the file read was in
	// progress; retaining the existing page keeps accounting deterministic.
	if element := p.items[index]; element != nil {
		p.order.MoveToFront(element)
		p.mu.Unlock()
		return element.Value.(*pageEntry).data, nil
	}
	element := p.order.PushFront(&pageEntry{index: index, data: data})
	p.items[index] = element
	p.bytes += int64(len(data))
	p.stats.CachedBytes = p.bytes
	p.stats.LoadedBytes += int64(len(data))
	p.stats.PageLoads++
	for p.bytes > p.max && p.order.Len() > 1 {
		old := p.order.Back()
		entry := old.Value.(*pageEntry)
		p.bytes -= int64(len(entry.data))
		delete(p.items, entry.index)
		p.order.Remove(old)
	}
	p.stats.CachedBytes = p.bytes
	p.mu.Unlock()
	return data, nil
}

func (p *pageSource) Stats() ReadStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	stats := p.stats
	stats.CachedBytes = p.bytes
	return stats
}

func (p *pageSource) Close() error {
	if p.close != nil {
		return p.close.Close()
	}
	return nil
}

type Kernel struct {
	data     []byte
	source   *pageSource
	size     int64
	little   bool
	Segments []Segment
}

type pathReaderAt string

func (path pathReaderAt) ReadAt(dst []byte, offset int64) (int, error) {
	file, err := os.Open(string(path))
	if err != nil {
		return 0, err
	}
	n, readErr := file.ReadAt(dst, offset)
	closeErr := file.Close()
	if readErr != nil {
		return n, readErr
	}
	return n, closeErr
}

func New(data []byte) (*Kernel, error) {
	k := &Kernel{data: data, size: int64(len(data))}
	return k.parse()
}

// Open opens an SPK without reading it into a long-lived byte slice. Metadata
// parsing and subsequent Evaluate calls use the bounded page cache.
func Open(path string) (*Kernel, error) {
	return OpenWithCache(path, DefaultPageSize, DefaultCacheBytes)
}

func OpenWithCache(path string, pageSize int, maxCacheBytes int64) (*Kernel, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	// No descriptor is retained per manifest entry. A page miss opens the file
	// only for its bounded ReadAt, while hot coefficient pages stay in memory.
	k := &Kernel{source: newPageSource(pathReaderAt(path), info.Size(), nil, pageSize, maxCacheBytes), size: info.Size()}
	if _, err := k.parse(); err != nil {
		_ = k.Close()
		return nil, err
	}
	return k, nil
}

func (k *Kernel) parse() (*Kernel, error) {
	if k.size < recordBytes*3 || k.size%recordBytes != 0 {
		return nil, fmt.Errorf("invalid SPK: file length is not whole 1024-byte records")
	}
	identifier, err := k.readString(0, 7)
	if err != nil || identifier != "DAF/SPK" {
		return nil, fmt.Errorf("invalid SPK: missing DAF/SPK identifier")
	}
	endian, err := k.readString(88, 8)
	if err != nil {
		return nil, fmt.Errorf("invalid SPK: truncated binary format")
	}
	if endian == "LTL-IEEE" {
		k.little = true
	} else if endian != "BIG-IEEE" {
		return nil, fmt.Errorf("invalid SPK: unsupported binary format %q", endian)
	}
	if k.i32(8) != 2 || k.i32(12) != 6 {
		return nil, fmt.Errorf("invalid SPK: expected ND=2 NI=6")
	}
	first, last := k.i32(76), k.i32(80)
	max := int(k.size / recordBytes)
	if first < 2 || last < first || last > max {
		return nil, fmt.Errorf("invalid SPK: summary bounds")
	}
	var sums [][2][]float64
	var rec, prev, seen = first, 0, 0
	visited := map[int]bool{}
	for rec != 0 {
		if seen > 1000000 || rec < 2 || rec > max || visited[rec] {
			return nil, fmt.Errorf("invalid SPK: summary chain")
		}
		visited[rec] = true
		seen++
		off := (rec - 1) * recordBytes
		next, back, count := k.control(off), k.control(off+8), k.control(off+16)
		if back != prev || count < 0 || count > 25 {
			return nil, fmt.Errorf("invalid SPK: summary links")
		}
		for n := 0; n < count; n++ {
			so := off + 24 + n*40
			d := []float64{k.f64(so), k.f64(so + 8)}
			ii := make([]float64, 6)
			for j := 0; j < 6; j++ {
				ii[j] = float64(k.i32(so + 16 + j*4))
			}
			sums = append(sums, [2][]float64{d, ii})
		}
		prev, rec = rec, next
	}
	if prev != last {
		return nil, fmt.Errorf("invalid SPK: summary chain does not terminate")
	}
	k.Segments = make([]Segment, 0, len(sums))
	for _, sum := range sums {
		s, e := sum[0], sum[1]
		seg, err := k.parseSegment(s, e)
		if err != nil {
			return nil, err
		}
		k.Segments = append(k.Segments, seg)
	}
	return k, nil
}

func (k *Kernel) readString(off, length int) (string, error) {
	data := make([]byte, length)
	if _, err := k.readAt(data, int64(off)); err != nil {
		return "", err
	}
	return string(data), nil
}

func (k *Kernel) ReadStats() ReadStats {
	if k.source == nil {
		return ReadStats{CachedBytes: int64(len(k.data)), LoadedBytes: int64(len(k.data)), MaxBytes: int64(len(k.data))}
	}
	return k.source.Stats()
}

func (k *Kernel) Close() error {
	if k.source != nil {
		return k.source.Close()
	}
	return nil
}

func (k *Kernel) Evaluate(target int, et float64) (State, bool, error) {
	if !finite(et) {
		return State{}, false, fmt.Errorf("invalid SPK: nonfinite epoch")
	}
	var unsupported *Segment
	for n := len(k.Segments) - 1; n >= 0; n-- {
		s := &k.Segments[n]
		if s.Target != target || et < s.StartET || et > s.EndET {
			continue
		}
		if (s.Frame != 1 && s.Frame != 17) || (s.Type != 2 && s.Type != 3 && s.Type != 17 && s.Type != 21) {
			unsupported = s
			break
		}
		var v [6]float64
		var err error
		switch {
		case s.type17:
			v, err = k.eval17(*s, et)
		case s.type21 != nil:
			v, err = k.eval21Correct(*s, et)
		default:
			v, err = k.evalCheb(*s, et)
		}
		if err != nil {
			return State{}, false, err
		}
		return State{Position: Vec3{v[0], v[1], v[2]}, Velocity: Vec3{v[3], v[4], v[5]}, Center: s.Center, Frame: s.Frame}, true, nil
	}
	if unsupported != nil {
		return State{}, false, fmt.Errorf("unsupported SPK segment frame=%d type=%d", unsupported.Frame, unsupported.Type)
	}
	return State{}, false, nil
}

// eval21Correct follows SPKE21's address arithmetic directly. Keeping this
// implementation separate from the compact legacy helper makes the offsets
// auditable against the NAIF routine and the CSPICE fixtures.
func (k *Kernel) eval21Correct(s Segment, et float64) ([6]float64, error) {
	var out [6]float64
	m := *s.type21
	lo, hi := 0, m.Records
	for lo < hi {
		mid := (lo + hi) / 2
		if k.addr(m.Epochs+mid) < et {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	if lo == m.Records {
		return out, fmt.Errorf("SPK type 21 epoch outside coverage")
	}
	off, delta := s.Start+lo*m.RecordSize, et-k.addr(s.Start+lo*m.RecordSize)
	if err := k.validateType21Record(off, m); err != nil {
		return out, err
	}
	max := int(k.addr(off + 4*m.Dimension + 7))
	fc, wc, w := make([]float64, m.Dimension), make([]float64, m.Dimension), make([]float64, m.Dimension+2)
	fc[0] = 1
	tp := delta
	for j := 1; j <= max-2; j++ {
		step := k.addr(off + j)
		fc[j] = tp / step
		wc[j-1] = delta / step
		tp = delta + step
	}
	for j := 1; j <= max; j++ {
		w[j-1] = 1 / float64(j)
	}
	ks, jx, ks1 := max-1, 0, max-2
	for ks >= 2 {
		jx++
		for j := 1; j <= jx; j++ {
			w[j+ks-1] = fc[j]*w[j+ks1-1] - wc[j-1]*w[j+ks-1]
		}
		ks, ks1 = ks1, ks1-1
	}
	for axis := 0; axis < 3; axis++ {
		sum := 0.0
		order := int(k.addr(off + 4*m.Dimension + 8 + axis))
		for j := order; j >= 1; j-- {
			sum += k.addr(off+m.Dimension+6+axis*m.Dimension+j) * w[j+ks-1]
		}
		out[axis] = k.addr(off+m.Dimension+1+2*axis) + delta*(k.addr(off+m.Dimension+2+2*axis)+delta*sum)
	}
	for j := 1; j <= jx; j++ {
		w[j+ks-1] = fc[j]*w[j+ks1-1] - wc[j-1]*w[j+ks-1]
	}
	ks--
	for axis := 0; axis < 3; axis++ {
		sum := 0.0
		order := int(k.addr(off + 4*m.Dimension + 8 + axis))
		for j := order; j >= 1; j-- {
			sum += k.addr(off+m.Dimension+6+axis*m.Dimension+j) * w[j+ks-1]
		}
		out[axis+3] = k.addr(off+m.Dimension+2+2*axis) + delta*sum
	}
	for _, v := range out {
		if !finite(v) {
			return out, fmt.Errorf("invalid SPK type 21 state")
		}
	}
	return out, nil
}

func (k *Kernel) validateType21Record(off int, m type21Meta) error {
	for j := 0; j < m.RecordSize; j++ {
		if !finite(k.addr(off + j)) {
			return fmt.Errorf("invalid SPK type 21 record")
		}
	}
	max := k.addr(off + 4*m.Dimension + 7)
	if max != math.Trunc(max) || max < 3 || max > float64(m.Dimension+1) {
		return fmt.Errorf("invalid SPK type 21 order")
	}
	for axis := 0; axis < 3; axis++ {
		order := k.addr(off + 4*m.Dimension + 8 + axis)
		if order != math.Trunc(order) || order < 0 || order >= max || order > float64(m.Dimension) {
			return fmt.Errorf("invalid SPK type 21 component order")
		}
	}
	for j := 0; j < int(max)-2; j++ {
		if k.addr(off+1+j) == 0 {
			return fmt.Errorf("invalid SPK type 21 zero step")
		}
	}
	return nil
}

func (k *Kernel) parseSegment(d, i []float64) (Segment, error) {
	if len(d) != 2 || len(i) != 6 {
		return Segment{}, fmt.Errorf("invalid SPK descriptor")
	}
	s := Segment{StartET: d[0], EndET: d[1], Target: int(i[0]), Center: int(i[1]), Frame: int(i[2]), Type: int(i[3]), Start: int(i[4]), End: int(i[5])}
	if !finite(s.StartET) || !finite(s.EndET) || s.StartET > s.EndET || s.Start < 1 || s.End < s.Start || int64(s.End) > k.size/8 {
		return Segment{}, fmt.Errorf("invalid SPK segment descriptor")
	}
	if s.Type == 17 {
		if s.End-s.Start+1 != 12 {
			return Segment{}, fmt.Errorf("invalid SPK type 17 record size")
		}
		s.Records, s.RecordSize = 1, 12
		s.type17 = true
		return s, nil
	}
	if s.Type == 21 {
		m, err := k.inspect21(s)
		if err != nil {
			return Segment{}, err
		}
		s.type21 = &m
		s.Records, s.RecordSize = m.Records, m.RecordSize
		return s, nil
	}
	if s.Type != 2 && s.Type != 3 {
		return s, nil
	}
	term := s.End - 3
	rs, count := k.addr(term+2), k.addr(term+3)
	if !finite(rs) || !finite(count) || rs != math.Trunc(rs) || count != math.Trunc(count) || rs < 5 || count < 1 || count > 1e7 {
		return Segment{}, fmt.Errorf("invalid SPK Chebyshev metadata")
	}
	if s.End-s.Start+1 != int(count*rs)+4 || ((s.Type == 2 && int(rs-2)%3 != 0) || (s.Type == 3 && int(rs-2)%6 != 0)) {
		return Segment{}, fmt.Errorf("invalid SPK Chebyshev layout")
	}
	s.RecordSize, s.Records = int(rs), int(count)
	s.Coefficients = (s.RecordSize - 2) / 3
	if s.Type == 3 {
		s.Coefficients = (s.RecordSize - 2) / 6
	}
	return s, nil
}

func (k *Kernel) evalCheb(s Segment, et float64) ([6]float64, error) {
	var out [6]float64
	init, interval := k.addr(s.End-3), k.addr(s.End-2)
	if !finite(init) || !finite(interval) || interval <= 0 {
		return out, fmt.Errorf("invalid SPK record time metadata")
	}
	idx := int(math.Floor((et - init) / interval))
	if idx < 0 {
		idx = 0
	}
	if idx >= s.Records {
		idx = s.Records - 1
	}
	off := s.Start + idx*s.RecordSize
	mid, rad := k.addr(off), k.addr(off+1)
	x := (et - mid) / rad
	if !finite(x) || math.Abs(x) > 1+1e-10 {
		return out, fmt.Errorf("SPK epoch outside record")
	}
	for axis := 0; axis < 3; axis++ {
		c := s.Coefficients
		v := k.cheb(off+2+axis*c, c, x)
		out[axis] = v[0]
		if s.Type == 2 {
			out[axis+3] = v[1] / rad
		} else {
			out[axis+3] = k.cheb(off+2+3*c+axis*c, c, x)[0]
		}
	}
	for _, value := range out {
		if !finite(value) {
			return out, fmt.Errorf("invalid SPK record coefficient")
		}
	}
	return out, nil
}
func (k *Kernel) cheb(off, c int, x float64) [2]float64 {
	var b1, b2, d1, d2 float64
	for j := c - 1; j >= 1; j-- {
		b := 2*x*b1 - b2 + k.addr(off+j)
		b2, b1 = b1, b
		dd := 2*x*d1 - d2 + 2*b2
		d2, d1 = d1, dd
	}
	return [2]float64{x*b1 - b2 + k.addr(off), x*d1 - d2 + b1}
}

func (k *Kernel) eval17(s Segment, et float64) ([6]float64, error) {
	var o [6]float64
	v := make([]float64, 12)
	for j := range v {
		v[j] = k.addr(s.Start + j)
	}
	for _, value := range v {
		if !finite(value) {
			return o, fmt.Errorf("invalid SPK type 17 nonfinite element")
		}
	}
	epoch, a, h, kx, longitude, p, q, periRate, meanRate, nodeRate, rapol, decpol := v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11]
	e := math.Hypot(h, kx)
	if a <= 0 || e > .9 || meanRate == 0 {
		return o, fmt.Errorf("invalid SPK type 17 elements")
	}
	dt := et - epoch
	dlp := periRate * dt
	hh, kk := h*math.Cos(dlp)+kx*math.Sin(dlp), kx*math.Cos(dlp)-h*math.Sin(dlp)
	nd := nodeRate * dt
	pp, qq := p*math.Cos(nd)+q*math.Sin(nd), q*math.Cos(nd)-p*math.Sin(nd)
	ml := wrap(longitude + meanRate*dt)
	ecc := ml
	ok := false
	for j := 0; j < 20; j++ {
		del := (ecc + hh*math.Cos(ecc) - kk*math.Sin(ecc) - ml) / (1 - hh*math.Sin(ecc) - kk*math.Cos(ecc))
		ecc -= del
		if math.Abs(del) < 2e-15 {
			ok = true
			break
		}
	}
	if !ok {
		lo, hi := ml-e, ml+e
		for j := 0; j < 80; j++ {
			m := (lo + hi) / 2
			if m+hh*math.Cos(m)-kk*math.Sin(m)-ml > 0 {
				hi = m
			} else {
				lo = m
			}
		}
		ecc = (lo + hi) / 2
		if math.Abs(ecc+hh*math.Cos(ecc)-kk*math.Sin(ecc)-ml) > 1e-13 {
			return o, fmt.Errorf("invalid SPK type 17 Kepler solve")
		}
	}
	ce, se := math.Cos(ecc), math.Sin(ecc)
	b := 1 / (math.Sqrt(1-hh*hh-kk*kk) + 1)
	x1 := a * ((1-b*hh*hh)*ce + (hh*kk*b*se - kk))
	y1 := a * ((1-b*kk*kk)*se + (hh*kk*b*ce - hh))
	rb := hh*se + kk*ce
	radius := a * (1 - rb)
	ra := meanRate * a * a / radius
	dx1, dy1 := ra*(-se+hh*b*rb), ra*(ce-kk*b*rb)
	nf := 1 - periRate/meanRate
	ar := periRate - nodeRate
	dx, dy := nf*dx1-ar*y1, nf*dy1+ar*x1
	f, g := basis(pp, qq, false), basis(pp, qq, true)
	pos := add(scale(f, x1), scale(g, y1))
	vel := add(scale(f, dx), scale(g, dy))
	vel.X += -nodeRate * pos.Y
	vel.Y += nodeRate * pos.X
	pole := Vec3{math.Cos(decpol) * math.Cos(rapol), math.Cos(decpol) * math.Sin(rapol), math.Sin(decpol)}
	xa := Vec3{-math.Sin(rapol), math.Cos(rapol), 0}
	ya := Vec3{-math.Sin(decpol) * math.Cos(rapol), -math.Sin(decpol) * math.Sin(rapol), math.Cos(decpol)}
	rp, rv := rotate(pos, xa, ya, pole), rotate(vel, xa, ya, pole)
	return [6]float64{rp.X, rp.Y, rp.Z, rv.X, rv.Y, rv.Z}, nil
}

func (k *Kernel) inspect21(s Segment) (type21Meta, error) {
	dim, n := k.addr(s.End-1), k.addr(s.End)
	if dim != math.Trunc(dim) || n != math.Trunc(n) || dim < 15 || dim > 25 || n < 1 || n > 1e7 {
		return type21Meta{}, fmt.Errorf("invalid SPK type 21 dimensions")
	}
	rs := 4*int(dim) + 11
	dc := int(n) / 100
	if s.End-s.Start+1 != int(n)*(rs+1)+dc+2 {
		return type21Meta{}, fmt.Errorf("invalid SPK type 21 layout")
	}
	epochs := s.Start + int(n)*rs
	return type21Meta{int(dim), rs, int(n), epochs}, nil
}
func (k *Kernel) eval21(s Segment, et float64) ([6]float64, error) {
	var out [6]float64
	m := *s.type21
	lo, hi := 0, m.Records
	for lo < hi {
		mid := (lo + hi) / 2
		if k.addr(m.Epochs+mid) < et {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	if lo == m.Records {
		return out, fmt.Errorf("SPK type 21 epoch outside coverage")
	}
	off := s.Start + lo*m.RecordSize
	delta := et - k.addr(off)
	max := int(k.addr(off + 4*m.Dimension + 7))
	fc, wc, w := make([]float64, m.Dimension), make([]float64, m.Dimension), make([]float64, m.Dimension+2)
	fc[0] = 1
	tp := delta
	for j := 1; j <= max-2; j++ {
		step := k.addr(off + j)
		fc[j] = tp / step
		wc[j-1] = delta / step
		tp = delta + step
	}
	for j := 1; j <= max; j++ {
		w[j-1] = 1 / float64(j)
	}
	ks, jx, ks1 := max-1, 0, max-2
	for ks >= 2 {
		jx++
		for j := 1; j <= jx; j++ {
			w[j+ks-1] = fc[j]*w[j+ks1-1] - wc[j-1]*w[j+ks-1]
		}
		ks, ks1 = ks1, ks1-1
	}
	for ax := 0; ax < 3; ax++ {
		sum := 0.0
		ord := int(k.addr(off + 4*m.Dimension + 8 + ax))
		for j := ord; j >= 1; j-- {
			sum += k.addr(off+m.Dimension+7+ax*m.Dimension+j) * w[j+ks-1]
		}
		out[ax] = k.addr(off+m.Dimension+1+2*ax) + delta*(k.addr(off+m.Dimension+2+2*ax)+delta*sum)
	}
	for j := 1; j <= jx; j++ {
		w[j+ks-1] = fc[j]*w[j+ks1-1] - wc[j-1]*w[j+ks-1]
	}
	ks--
	for ax := 0; ax < 3; ax++ {
		sum := 0.0
		ord := int(k.addr(off + 4*m.Dimension + 8 + ax))
		for j := ord; j >= 1; j-- {
			sum += k.addr(off+m.Dimension+7+ax*m.Dimension+j) * w[j+ks-1]
		}
		out[ax+3] = k.addr(off+m.Dimension+2+2*ax) + delta*sum
	}
	for _, x := range out {
		if !finite(x) {
			return out, fmt.Errorf("invalid SPK type 21 state")
		}
	}
	return out, nil
}

func (k *Kernel) f64(off int) float64 {
	if off < 0 || int64(off)+8 > k.length() {
		return math.NaN()
	}
	var raw [8]byte
	if _, err := k.readAt(raw[:], int64(off)); err != nil {
		return math.NaN()
	}
	if k.little {
		return math.Float64frombits(binary.LittleEndian.Uint64(raw[:]))
	}
	return math.Float64frombits(binary.BigEndian.Uint64(raw[:]))
}
func (k *Kernel) i32(off int) int {
	if off < 0 || int64(off)+4 > k.length() {
		return -1
	}
	var raw [4]byte
	if _, err := k.readAt(raw[:], int64(off)); err != nil {
		return -1
	}
	if k.little {
		return int(int32(binary.LittleEndian.Uint32(raw[:])))
	}
	return int(int32(binary.BigEndian.Uint32(raw[:])))
}
func (k *Kernel) control(off int) int {
	v := k.f64(off)
	if !finite(v) || v < 0 || v != math.Trunc(v) {
		return -1
	}
	return int(v)
}
func (k *Kernel) addr(a int) float64 {
	if a < 1 || int64(a) > k.length()/8 {
		return math.NaN()
	}
	return k.f64((a - 1) * 8)
}

func (k *Kernel) length() int64 {
	if k.size > 0 {
		return k.size
	}
	return int64(len(k.data))
}

func (k *Kernel) readAt(dst []byte, off int64) (int, error) {
	if k.source != nil {
		return k.source.ReadAt(dst, off)
	}
	if off < 0 || off >= int64(len(k.data)) && len(dst) > 0 {
		return 0, io.EOF
	}
	n := copy(dst, k.data[off:])
	if n != len(dst) {
		return n, io.EOF
	}
	return n, nil
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
func wrap(v float64) float64 { return v - 2*math.Pi*math.Floor((v+math.Pi)/(2*math.Pi)) }
func basis(p, q float64, second bool) Vec3 {
	d := 1 + p*p + q*q
	if second {
		return Vec3{2 * p * q / d, (1 + p*p - q*q) / d, 2 * q / d}
	}
	return Vec3{(1 - p*p + q*q) / d, 2 * p * q / d, -2 * p / d}
}
func add(a, b Vec3) Vec3           { return Vec3{a.X + b.X, a.Y + b.Y, a.Z + b.Z} }
func scale(a Vec3, v float64) Vec3 { return Vec3{a.X * v, a.Y * v, a.Z * v} }
func rotate(v, x, y, z Vec3) Vec3 {
	return Vec3{v.X*x.X + v.Y*y.X + v.Z*z.X, v.X*x.Y + v.Y*y.Y + v.Z*z.Y, v.X*x.Z + v.Y*y.Z + v.Z*z.Z}
}
