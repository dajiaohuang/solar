package httpapi

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

const (
	stateWindowMediaType = "application/vnd.solar.state-window+binary"
	maxWindowIDs         = 1024
	maxWindowEpochs      = 1024
	maxWindowStates      = 262144
	windowLookahead      = 4
)

type stateWindowRequest struct {
	statePlanRequest
	Epochs []float64 `json:"epochsJd"`
}

// A stream is a sequence of uint32 little-endian length-prefixed frames:
// window JSON, (epoch JSON, the epoch's binary tiles)*, complete JSON.
// A disconnected/failed stream has no completion certificate. Lookahead is
// bounded independently of the number of epochs and releases CPU admission
// before encoding or writing to a slow consumer.
func (s *Server) stateWindow(w http.ResponseWriter, r *http.Request) {
	var req stateWindowRequest
	if err := decodeOneJSON(r, &req); err != nil {
		s.error(w, 400, "invalid_json", err.Error())
		return
	}
	if len(req.Epochs) < 1 || len(req.Epochs) > maxWindowEpochs || len(req.IDs) > maxWindowIDs || len(req.IDs)*len(req.Epochs) > maxWindowStates {
		s.error(w, 400, "invalid_window", "window exceeds ID, epoch or body-epoch limits")
		return
	}
	for n, epoch := range req.Epochs {
		if !finite(epoch) || n > 0 && epoch <= req.Epochs[n-1] {
			s.error(w, 400, "invalid_window", "epochs must be finite and strictly increasing")
			return
		}
	}
	req.EpochJD = req.Epochs[0]
	req.TileSize = maxWindowIDs
	ids, err := normalizePlanRequest(&req.statePlanRequest)
	if err != nil {
		s.error(w, 400, "invalid_window", err.Error())
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	type result struct {
		plan *statePlan
		err  error
	}
	count := min(windowLookahead, len(req.Epochs))
	pending := make([]chan result, count)
	for n := range pending {
		pending[n] = make(chan result, 1)
	}
	var workers sync.WaitGroup
	// A worker starts another epoch only after the consumer has committed its
	// previous result. This ring bounds active + ready plans, not just LRU data.
	permits := make([]chan struct{}, count)
	for lane := 0; lane < count; lane++ {
		permits[lane] = make(chan struct{}, 1)
		permits[lane] <- struct{}{}
		workers.Add(1)
		go func(lane int) {
			defer workers.Done()
			for n := lane; n < len(req.Epochs); n += count {
				select {
				case <-ctx.Done():
					return
				case <-permits[lane]:
				}
				request := req.statePlanRequest
				request.EpochJD = req.Epochs[n]
				plan, err := s.buildStatePlan(ctx, request, ids)
				select {
				case <-ctx.Done():
					return
				case pending[lane] <- result{plan, err}:
				}
				if err != nil {
					return
				}
			}
		}(lane)
	}
	defer func() { cancel(); workers.Wait() }()
	controller := http.NewResponseController(w)
	w.Header().Set("Content-Type", stateWindowMediaType)
	write := func(raw []byte) error {
		// A stalled consumer must not pin output buffers indefinitely. Each
		// successful frame refreshes the write deadline, not the whole task.
		_ = controller.SetWriteDeadline(time.Now().Add(30 * time.Second))
		return writeWindowFrame(w, raw)
	}
	writeJSON := func(value any) error {
		raw, err := json.Marshal(value)
		if err != nil {
			return err
		}
		return write(raw)
	}
	if err := writeJSON(map[string]any{"kind": "window", "version": 1, "epochCount": len(req.Epochs), "bodyCount": len(ids), "requestIdsSha256": requestIDsHash(ids), "catalogManifestSha256": s.catalog.ManifestHash()}); err != nil {
		return
	}
	_ = controller.Flush()
	exact, missing := 0, 0
	for n := range req.Epochs {
		var value result
		select {
		case <-ctx.Done():
			return
		case value = <-pending[n%count]:
		}
		if value.err != nil {
			_ = writeJSON(map[string]any{"kind": "error", "message": value.err.Error()})
			return
		}
		if err := writeJSON(map[string]any{"kind": "epoch", "epochIndex": n, "plan": value.plan.response}); err != nil {
			return
		}
		for sequence := range value.plan.response.Tiles {
			tile, err := s.encodeStateTileWithWait(ctx, value.plan, uint32(sequence), true)
			if err != nil {
				return
			} // no final summary: the client fails closed
			if err := write(tile.raw); err != nil {
				return
			}
		}
		exact += value.plan.response.ExactCount
		missing += value.plan.response.MissingCount
		if err := controller.Flush(); err != nil {
			return
		}
		permits[n%count] <- struct{}{}
	}
	_ = writeJSON(map[string]any{"kind": "complete", "epochCount": len(req.Epochs), "bodyCount": len(ids), "exactCount": exact, "missingCount": missing})
}

func writeWindowFrame(w io.Writer, raw []byte) error {
	if len(raw) > maxStateTileBytes {
		return fmt.Errorf("window frame exceeds byte limit")
	}
	var size [4]byte
	binary.LittleEndian.PutUint32(size[:], uint32(len(raw)))
	if n, err := w.Write(size[:]); err != nil {
		return err
	} else if n != len(size) {
		return io.ErrShortWrite
	}
	n, err := w.Write(raw)
	if err == nil && n != len(raw) {
		return io.ErrShortWrite
	}
	return err
}
