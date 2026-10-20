package catalog

import (
	"encoding/hex"
	"testing"
)

func TestSourceChainV2MatchesSharedByteLayout(t *testing.T) {
	kernelHash := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	parent := hex.EncodeToString(sourceChainOrigin[:])
	got, err := sourceChainSegmentSHA256("fixture", kernelHash, -1, 0, 17, 2, -0.5, 1.25, parent)
	if err != nil {
		t.Fatal(err)
	}
	const want = "8d54a3ecfe026612be307e8bb4926acaeb9ccf22ebb2e8f0fc6553a02d2df338"
	if got != want {
		t.Fatalf("source-chain digest=%s want shared Node vector %s", got, want)
	}
	changed, err := sourceChainSegmentSHA256("fixture", kernelHash, -1, 0, 17, 3, -0.5, 1.25, parent)
	if err != nil {
		t.Fatal(err)
	}
	if changed == got {
		t.Fatal("SPK type change did not alter source-chain digest")
	}
}
