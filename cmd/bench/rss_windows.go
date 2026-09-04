//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var psapi = syscall.NewLazyDLL("psapi.dll")
var getProcessMemoryInfo = psapi.NewProc("GetProcessMemoryInfo")

// processMemoryCounters is the stable prefix used by GetProcessMemoryInfo.
// uintptr keeps this correct for both 32-bit and 64-bit Windows builds.
type processMemoryCounters struct {
	CB                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
}

func processRSSBytes() uint64 {
	counters := processMemoryCounters{CB: uint32(unsafe.Sizeof(processMemoryCounters{}))}
	handle, _ := syscall.GetCurrentProcess()
	ret, _, _ := getProcessMemoryInfo.Call(uintptr(handle), uintptr(unsafe.Pointer(&counters)), uintptr(counters.CB))
	if ret == 0 {
		return 0
	}
	return uint64(counters.WorkingSetSize)
}
