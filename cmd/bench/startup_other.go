//go:build !windows

package main

// Do not relabel a current RSS sample as an OS high-water mark on platforms
// where this harness has no native peak implementation.
func startupProcessPeakRSS() (uint64, bool) { return 0, false }
