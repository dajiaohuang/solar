// Package spk implements the bounded, read-only subset of NAIF DAF/SPK used
// by Solar Atlas. It evaluates original type 2/3/17/21 records; it does not
// fit, integrate or synthesize an orbit.
package spk

import (
	"encoding/binary"
	"fmt"
	"math"
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

type Kernel struct {
	data     []byte
	little   bool
	Segments []Segment
}

func New(data []byte) (*Kernel, error) {
	if len(data) < recordBytes*3 || len(data)%recordBytes != 0 {
		return nil, fmt.Errorf("invalid SPK: file length is not whole 1024-byte records")
	}
	k := &Kernel{data: data}
	if string(data[:7]) != "DAF/SPK" {
		return nil, fmt.Errorf("invalid SPK: missing DAF/SPK identifier")
	}
	endian := string(data[88:96])
	if endian == "LTL-IEEE" {
		k.little = true
	} else if endian != "BIG-IEEE" {
		return nil, fmt.Errorf("invalid SPK: unsupported binary format %q", endian)
	}
	if k.i32(8) != 2 || k.i32(12) != 6 {
		return nil, fmt.Errorf("invalid SPK: expected ND=2 NI=6")
	}
	first, last := k.i32(76), k.i32(80)
	max := len(data) / recordBytes
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

func (k *Kernel) parseSegment(d, i []float64) (Segment, error) {
	if len(d) != 2 || len(i) != 6 {
		return Segment{}, fmt.Errorf("invalid SPK descriptor")
	}
	s := Segment{StartET: d[0], EndET: d[1], Target: int(i[0]), Center: int(i[1]), Frame: int(i[2]), Type: int(i[3]), Start: int(i[4]), End: int(i[5])}
	if !finite(s.StartET) || !finite(s.EndET) || s.StartET > s.EndET || s.Start < 1 || s.End < s.Start || s.End > len(k.data)/8 {
		return Segment{}, fmt.Errorf("invalid SPK segment descriptor")
	}
	if s.Type == 17 {
		if s.End-s.Start+1 != 12 {
			return Segment{}, fmt.Errorf("invalid SPK type 17 record size")
		}
		for a := s.Start; a <= s.End; a++ {
			if !finite(k.addr(a)) {
				return Segment{}, fmt.Errorf("invalid SPK type 17 nonfinite element")
			}
		}
		e := math.Hypot(k.addr(s.Start+2), k.addr(s.Start+3))
		if k.addr(s.Start+1) <= 0 || e > .9 || k.addr(s.Start+8) == 0 {
			return Segment{}, fmt.Errorf("invalid SPK type 17 elements")
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
	for n := 0; n < s.Records; n++ {
		off := s.Start + n*s.RecordSize
		if k.addr(off+1) <= 0 || !finite(k.addr(off)) {
			return Segment{}, fmt.Errorf("invalid SPK record midpoint/radius")
		}
		for j := 0; j < 3*s.Coefficients*(1+boolInt(s.Type == 3)); j++ {
			if !finite(k.addr(off + 3 + j)) {
				return Segment{}, fmt.Errorf("invalid SPK coefficient")
			}
		}
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
	epoch, a, h, kx, longitude, p, q, periRate, meanRate, nodeRate, rapol, decpol := v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11]
	e := math.Hypot(h, kx)
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
	prev := -math.MaxFloat64
	for i := 0; i < int(n); i++ {
		ep := k.addr(epochs + i)
		if !finite(ep) || ep <= prev {
			return type21Meta{}, fmt.Errorf("invalid SPK type 21 epochs")
		}
		prev = ep
		off := s.Start + i*rs
		for j := 0; j < rs; j++ {
			if !finite(k.addr(off + j)) {
				return type21Meta{}, fmt.Errorf("invalid SPK type 21 record")
			}
		}
		max := k.addr(off + 4*int(dim) + 7)
		if max != math.Trunc(max) || max < 3 || max > dim+1 {
			return type21Meta{}, fmt.Errorf("invalid SPK type 21 order")
		}
		for ax := 0; ax < 3; ax++ {
			ord := k.addr(off + 4*int(dim) + 8 + ax)
			if ord != math.Trunc(ord) || ord < 0 || ord >= max || ord > dim {
				return type21Meta{}, fmt.Errorf("invalid SPK type 21 component order")
			}
		}
		for j := 0; j < int(max)-2; j++ {
			if k.addr(off+1+j) == 0 {
				return type21Meta{}, fmt.Errorf("invalid SPK type 21 zero step")
			}
		}
	}
	if prev < s.EndET {
		return type21Meta{}, fmt.Errorf("invalid SPK type 21 coverage")
	}
	for i := 0; i < dc; i++ {
		if k.addr(epochs+int(n)+i) != k.addr(epochs+(i+1)*100-1) {
			return type21Meta{}, fmt.Errorf("invalid SPK type 21 directory")
		}
	}
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
	if off < 0 || off+8 > len(k.data) {
		return math.NaN()
	}
	if k.little {
		return math.Float64frombits(binary.LittleEndian.Uint64(k.data[off:]))
	}
	return math.Float64frombits(binary.BigEndian.Uint64(k.data[off:]))
}
func (k *Kernel) i32(off int) int {
	if off < 0 || off+4 > len(k.data) {
		return -1
	}
	if k.little {
		return int(int32(binary.LittleEndian.Uint32(k.data[off:])))
	}
	return int(int32(binary.BigEndian.Uint32(k.data[off:])))
}
func (k *Kernel) control(off int) int {
	v := k.f64(off)
	if !finite(v) || v < 0 || v != math.Trunc(v) {
		return -1
	}
	return int(v)
}
func (k *Kernel) addr(a int) float64 {
	if a < 1 || a > len(k.data)/8 {
		return math.NaN()
	}
	return k.f64((a - 1) * 8)
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
