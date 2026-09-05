package main

import (
	"runtime"
	"time"
)

type startupEvidence struct {
	ElapsedMs            float64 `json:"elapsedMs"`
	ResidentBytes        uint64  `json:"residentBytes"`
	HeapBytes            uint64  `json:"heapBytes"`
	ProcessPeakRSSBytes  uint64  `json:"processPeakRSSBytes"`
	ProcessPeakAvailable bool    `json:"processPeakAvailable"`
	Measurement          string  `json:"measurement"`
	Scope                string  `json:"scope"`
}

func captureStartup(start time.Time) startupEvidence {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	rss := processRSSBytes()
	peak, available := startupProcessPeakRSS()
	return startupEvidence{
		ElapsedMs: elapsedMilliseconds(start), ResidentBytes: rss, HeapBytes: memory.HeapAlloc,
		ProcessPeakRSSBytes: peak, ProcessPeakAvailable: available,
		Measurement: "resident/heap sampled after catalog and inventory load; process peak is OS high-water when available",
		Scope:       "cold process, including runtime/catalog/inventory; OS filesystem cache uncontrolled; excludes request workloads and first-use kernel verification",
	}
}
