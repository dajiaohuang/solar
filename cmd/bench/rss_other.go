//go:build !windows

package main

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

// Linux exposes resident set size without a dependency. Other Unix-like
// systems return zero and still report Go heap high-water marks.
func processRSSBytes() uint64 {
	f, err := os.Open("/proc/self/status")
	if err != nil {
		return 0
	}
	defer f.Close()
	scan := bufio.NewScanner(f)
	for scan.Scan() {
		fields := strings.Fields(scan.Text())
		if len(fields) == 3 && fields[0] == "VmRSS:" && fields[2] == "kB" {
			kb, err := strconv.ParseUint(fields[1], 10, 64)
			if err == nil {
				return kb * 1024
			}
		}
	}
	return 0
}
