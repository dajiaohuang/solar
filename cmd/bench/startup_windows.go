//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

func startupProcessPeakRSS() (uint64, bool) {
	counters := processMemoryCounters{CB: uint32(unsafe.Sizeof(processMemoryCounters{}))}
	handle, err := syscall.GetCurrentProcess()
	if err != nil {
		return 0, false
	}
	ret, _, _ := getProcessMemoryInfo.Call(uintptr(handle), uintptr(unsafe.Pointer(&counters)), uintptr(counters.CB))
	if ret == 0 || counters.PeakWorkingSetSize == 0 {
		return 0, false
	}
	return uint64(counters.PeakWorkingSetSize), true
}
