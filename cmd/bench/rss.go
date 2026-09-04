package main

import "runtime"

type peakMemory struct {
	rss, heap uint64
}

func newPeak() *peakMemory { return &peakMemory{} }

func (p *peakMemory) Sample() {
	if rss := processRSSBytes(); rss > p.rss {
		p.rss = rss
	}
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	if stats.HeapAlloc > p.heap {
		p.heap = stats.HeapAlloc
	}
}
