package orbituncertainty

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/dajiaohuang/solar/backend/internal/spk"
)

// DE440Source is an immutable, concurrently reusable source snapshot. Its
// bytes, kernel descriptors and parsed GMs never escape; each dynamics run
// still owns separate center-chain caches, exclusions and force scratch.
type DE440Source struct {
	kernel *spk.Kernel
	masses []PointMass
}

func NewDE440Source(ctx context.Context, originalSPK, originalGM []byte) (*DE440Source, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(originalSPK) != 5558272 || len(originalGM) == 0 || len(originalGM) > 1<<20 {
		return nil, errors.New("unexpected pinned DE440 source byte sizes")
	}
	spkBytes, gmBytes := bytes.Clone(originalSPK), bytes.Clone(originalGM)
	hash := func(raw []byte) string { value := sha256.Sum256(raw); return hex.EncodeToString(value[:]) }
	if hash(spkBytes) != de440Hash || hash(gmBytes) != de440GMHash {
		return nil, errors.New("DE440 dynamics source checksum mismatch")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	kernel, err := spk.New(spkBytes)
	if err != nil {
		return nil, err
	}
	for _, segment := range kernel.Segments {
		if segment.Frame != 1 || (segment.Type != 2 && segment.Type != 3) {
			return nil, errors.New("pinned dynamics requires J2000 Chebyshev segments")
		}
	}
	ids := []int{10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9}
	masses := make([]PointMass, len(ids))
	gmText := string(gmBytes)
	for i, id := range ids {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		match := regexp.MustCompile(fmt.Sprintf(`BODY%d_GM\s*=\s*\(\s*([\d.EeDd+-]+)`, id)).FindStringSubmatch(gmText)
		if len(match) != 2 {
			return nil, fmt.Errorf("missing DE440 GM for NAIF %d", id)
		}
		gm, err := strconv.ParseFloat(strings.NewReplacer("d", "E", "D", "E").Replace(match[1]), 64)
		if err != nil || !finite(gm) || gm <= 0 {
			return nil, fmt.Errorf("invalid DE440 GM for NAIF %d", id)
		}
		masses[i] = PointMass{NAIFID: id, GMKm3PerSecond2: gm, GMSource: de440GMSource + " SHA-256 " + de440GMHash}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &DE440Source{kernel: kernel, masses: masses}, nil
}
