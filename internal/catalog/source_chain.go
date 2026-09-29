package catalog

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
)

var sourceChainOrigin = sha256.Sum256([]byte("solar-spk-source-chain-v2:ssb"))

const sourceChainSegmentDomain = "solar-spk-source-chain-v2:segment\x00"

// sourceChainSegmentSHA256 binds one selected SPK descriptor and verified
// kernel file to the recursively selected center chain. Its byte layout is
// shared with scripts/lib/inventory-kernels.mjs.
func sourceChainSegmentSHA256(source, kernelSHA256 string, target, center, frame, segmentType int, startET, endET float64, parentSHA256 string) (string, error) {
	if source == "" || uint64(len(source)) > uint64(^uint32(0)) || !validFloat(startET) || !validFloat(endET) || endET < startET {
		return "", fmt.Errorf("invalid SPK source-chain descriptor")
	}
	for _, value := range []int{target, center, frame, segmentType} {
		if int64(value) < -1<<31 || int64(value) > 1<<31-1 {
			return "", fmt.Errorf("SPK source-chain identity is outside int32")
		}
	}
	kernelDigest, err := hex.DecodeString(kernelSHA256)
	if err != nil || len(kernelDigest) != sha256.Size {
		return "", fmt.Errorf("invalid SPK source-chain kernel checksum")
	}
	parentDigest, err := hex.DecodeString(parentSHA256)
	if err != nil || len(parentDigest) != sha256.Size {
		return "", fmt.Errorf("invalid SPK source-chain parent checksum")
	}

	encoded := make([]byte, 0, len(sourceChainSegmentDomain)+4+len(source)+sha256.Size+4*4+8*2+sha256.Size)
	encoded = append(encoded, sourceChainSegmentDomain...)
	var scratch [8]byte
	binary.LittleEndian.PutUint32(scratch[:4], uint32(len(source)))
	encoded = append(encoded, scratch[:4]...)
	encoded = append(encoded, source...)
	encoded = append(encoded, kernelDigest...)
	for _, value := range []int{target, center, frame, segmentType} {
		binary.LittleEndian.PutUint32(scratch[:4], uint32(int32(value)))
		encoded = append(encoded, scratch[:4]...)
	}
	binary.LittleEndian.PutUint64(scratch[:], math.Float64bits(startET))
	encoded = append(encoded, scratch[:]...)
	binary.LittleEndian.PutUint64(scratch[:], math.Float64bits(endET))
	encoded = append(encoded, scratch[:]...)
	encoded = append(encoded, parentDigest...)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}
