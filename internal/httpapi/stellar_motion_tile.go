package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/stellarmotion"
)

// A 1 MiB manifest plus a 32 MiB Gaia chunk expands to 44 MiB as base64.
const gaiaMotionTileRequestBytes = 45 << 20
const gaiaMotionBatchRowsMax = stellarmotion.MaxBatchRows

func (s *Server) stellarMotionTile(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	var wire struct {
		Manifest  []byte   `json:"originalManifestBase64"`
		ChunkPath string   `json:"chunkPath"`
		Chunk     []byte   `json:"originalChunkBase64"`
		Epoch     *float64 `json:"targetEpochJulianYearTCB"`
		Policy    string   `json:"radialVelocityPolicy"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, gaiaMotionTileRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			s.error(w, http.StatusRequestEntityTooLarge, "stellar_batch_request_too_large", "Gaia motion batch request exceeds 45 MiB")
		} else {
			s.error(w, http.StatusBadRequest, "invalid_stellar_batch_request", "expected bounded original manifest and chunk bytes with known fields")
		}
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF || wire.Epoch == nil || len(wire.Manifest) == 0 || len(wire.Chunk) == 0 || wire.ChunkPath == "" {
		s.error(w, http.StatusBadRequest, "invalid_stellar_batch_request", "exactly one object with an explicit TCB epoch and Gaia chunk is required")
		return
	}
	release, err := s.compute.acquire(ctx, computeClass(ctx))
	if err != nil {
		if ctx.Err() != nil {
			s.error(w, http.StatusRequestTimeout, "cancelled", "stellar batch cancelled or deadline exceeded")
		} else {
			w.Header().Set("Retry-After", "1")
			s.error(w, http.StatusTooManyRequests, "overloaded", "stellar compute queue is full or its wait expired")
		}
		return
	}
	defer release()
	result, err := s.stellarManifests.PropagateVerifiedChunk(ctx, wire.Manifest, wire.ChunkPath, wire.Chunk, *wire.Epoch, wire.Policy)
	if err != nil {
		if ctx.Err() != nil {
			s.error(w, http.StatusRequestTimeout, "cancelled", "stellar batch cancelled or deadline exceeded")
		} else {
			s.error(w, http.StatusUnprocessableEntity, "invalid_stellar_batch_source", err.Error())
		}
		return
	}
	s.jsonLimited(w, http.StatusOK, map[string]any{"apiVersion": catalog.APIVersion, "experiment": result}, 14<<20)
}
