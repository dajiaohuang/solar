package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"

	"github.com/dajiaohuang/solar/backend/internal/catalog"
	"github.com/dajiaohuang/solar/backend/internal/science"
)

const maxBodyBytes = 1 << 20

type Server struct {
	catalog  *catalog.Catalog
	slots    chan struct{}
	inFlight atomic.Int64
}

func New(c *catalog.Catalog, maxConcurrent int) *Server {
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	return &Server{catalog: c, slots: make(chan struct{}, maxConcurrent)}
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Solar-API-Version", catalog.APIVersion)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/v1/") {
		s.error(w, http.StatusNotFound, "not_found", "unknown endpoint")
		return
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-r.Context().Done():
		s.error(w, http.StatusRequestTimeout, "cancelled", "request cancelled")
		return
	}
	s.inFlight.Add(1)
	defer s.inFlight.Add(-1)
	path := strings.TrimPrefix(r.URL.Path, "/v1/")
	switch {
	case r.Method == "GET" && path == "capabilities":
		s.capabilities(w, r)
	case r.Method == "GET" && path == "catalog":
		s.catalogPage(w, r)
	case r.Method == "GET" && strings.HasPrefix(path, "bodies/"):
		s.body(w, r, strings.TrimPrefix(path, "bodies/"))
	case r.Method == "POST" && path == "trajectory":
		s.trajectory(w, r)
	case r.Method == "GET" && path == "preview/manifest":
		s.preview(w, r)
	default:
		s.error(w, http.StatusNotFound, "not_found", "unknown endpoint")
	}
}

func (s *Server) capabilities(w http.ResponseWriter, _ *http.Request) {
	s.json(w, http.StatusOK, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "manifestSha256": s.catalog.ManifestHash(), "coverage": map[string]any{"goal": "all-known-solar-system-bodies", "manifestProfile": s.catalog.ManifestProfile(), "manifestContract": s.catalog.ManifestContract(), "counts": s.catalog.Stats()}, "contract": map[string]any{"timeScale": "TDB", "epoch": "Julian date", "frame": "ECLIPJ2000", "distanceUnit": "km", "velocityUnit": "km/s", "modelBoundary": "SPK operational states when packaged; otherwise explicit fixed two-body fallback", "nBody": false}, "limits": map[string]int{"catalogPageMax": 500, "trajectoryBodiesMax": 64, "trajectorySamplesMax": 10000}, "profiles": map[string]any{"full": map[string]any{"catalog": true, "trajectory": true}, "preview": map[string]any{"catalog": "curated", "fullOnlyVisible": true, "restrictedActions": "blocked"}}})
}

func (s *Server) catalogPage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit, err := parseIntDefault(r.URL.Query().Get("limit"), 100)
	if err != nil || limit < 1 || limit > 500 {
		s.error(w, 400, "invalid_limit", "limit must be between 1 and 500")
		return
	}
	offset := 0
	token := r.URL.Query().Get("pageToken")
	if token != "" {
		b, e := base64.RawURLEncoding.DecodeString(token)
		if e != nil {
			s.error(w, 400, "invalid_page_token", "pageToken is invalid")
			return
		}
		offset, err = strconv.Atoi(string(b))
		if err != nil || offset < 0 {
			s.error(w, 400, "invalid_page_token", "pageToken is invalid")
			return
		}
	}
	items := s.catalog.Page(q, offset, limit)
	next := ""
	if len(items) == limit {
		next = base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset + len(items))))
	}
	s.json(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "items": items, "nextPageToken": next, "offset": offset, "limit": limit})
}

func (s *Server) body(w http.ResponseWriter, r *http.Request, id string) {
	if strings.Contains(id, "/") || id == "" {
		s.error(w, 400, "invalid_body_id", "body id must be one stable segment")
		return
	}
	b, ok := s.catalog.Get(id)
	if !ok {
		s.error(w, 404, "body_not_found", "unknown body id")
		return
	}
	s.json(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "body": b})
}

type trajectoryRequest struct {
	BodyIDs []string `json:"bodyIds"`
	StartJD float64  `json:"startJd"`
	EndJD   float64  `json:"endJd"`
	Samples int      `json:"samples"`
	Frame   string   `json:"frame"`
}
type trajectoryBody struct {
	ID            string               `json:"id"`
	Availability  catalog.Availability `json:"availability"`
	MissingReason string               `json:"missingReason,omitempty"`
	Model         string               `json:"model,omitempty"`
	States        []catalog.State      `json:"states,omitempty"`
}

func (s *Server) trajectory(w http.ResponseWriter, r *http.Request) {
	var req trajectoryRequest
	dec := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes))
	if err := dec.Decode(&req); err != nil {
		s.error(w, 400, "invalid_json", "request body is not valid JSON")
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		s.error(w, 400, "invalid_json", "request body must contain one JSON object")
		return
	}
	if len(req.BodyIDs) < 1 || len(req.BodyIDs) > 64 {
		s.error(w, 400, "invalid_body_count", "bodyIds must contain 1..64 entries")
		return
	}
	if req.Samples < 2 || req.Samples > 10000 {
		s.error(w, 400, "invalid_samples", "samples must be between 2 and 10000")
		return
	}
	if !finite(req.StartJD) || !finite(req.EndJD) || req.EndJD <= req.StartJD || req.EndJD-req.StartJD > 365250 {
		s.error(w, 400, "invalid_time_range", "time range must be positive and at most 1000 years")
		return
	}
	if req.Frame == "" {
		req.Frame = "ECLIPJ2000"
	}
	if req.Frame != "ECLIPJ2000" {
		s.error(w, 400, "unsupported_frame", "only ECLIPJ2000 is supported")
		return
	}
	step := (req.EndJD - req.StartJD) / float64(req.Samples-1)
	out := make([]trajectoryBody, 0, len(req.BodyIDs))
	seen := map[string]bool{}
	for _, id := range req.BodyIDs {
		if seen[id] {
			s.error(w, 400, "duplicate_body_id", "bodyIds must be unique")
			return
		}
		seen[id] = true
		b, ok := s.catalog.Get(id)
		if !ok {
			s.error(w, 404, "body_not_found", "unknown body id: "+id)
			return
		}
		tb := trajectoryBody{ID: id, Availability: b.Availability, MissingReason: b.MissingReason, Model: b.Model}
		if b.Availability == catalog.Missing || b.Elements == nil {
			if tb.MissingReason == "" {
				tb.MissingReason = "no-supported-state-model"
			}
			out = append(out, tb)
			continue
		}
		tb.Model = b.Model
		tb.States = make([]catalog.State, req.Samples)
		for i := 0; i < req.Samples; i++ {
			if err := r.Context().Err(); err != nil {
				s.error(w, 408, "cancelled", "request cancelled")
				return
			}
			st, err := science.PropagateBoundElliptic(r.Context(), science.Elements{SemiMajorAxisAU: b.Elements.SemiMajorAxisAU, Eccentricity: b.Elements.Eccentricity, InclinationDeg: b.Elements.InclinationDeg, AscendingNodeDeg: b.Elements.AscendingNodeDeg, ArgPeriapsisDeg: b.Elements.ArgPeriapsisDeg, MeanAnomalyDeg: b.Elements.MeanAnomalyDeg, MeanMotionDegPerDay: b.Elements.MeanMotionDegPerDay}, b.EpochJD, req.StartJD+float64(i)*step)
			if err != nil {
				s.error(w, 422, "state_unavailable", err.Error())
				return
			}
			tb.States[i] = catalog.State{Position: catalog.Vec3{X: st.Position.X, Y: st.Position.Y, Z: st.Position.Z}, Velocity: catalog.Vec3{X: st.Velocity.X, Y: st.Velocity.Y, Z: st.Velocity.Z}}
		}
		out = append(out, tb)
	}
	s.json(w, 200, map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "frame": req.Frame, "timeScale": "TDB", "startJd": req.StartJD, "endJd": req.EndJD, "distanceUnit": "km", "velocityUnit": "km/s", "modelBoundary": "Each body retains its source/model; fallback states are not operational ephemerides.", "bodies": out})
}

func (s *Server) preview(w http.ResponseWriter, _ *http.Request) {
	body := map[string]any{"apiVersion": catalog.APIVersion, "catalogVersion": s.catalog.Version(), "manifestSha256": s.catalog.ManifestHash(), "profile": "pages-preview", "generatedAt": "", "entries": []map[string]any{{"id": "sun", "availability": "available"}, {"id": "earth", "availability": "available"}, {"id": "moon", "availability": "available"}, {"id": "mars", "availability": "available"}, {"id": "jupiter", "availability": "available"}, {"id": "saturn", "availability": "available"}, {"id": "uranus", "availability": "full-only", "label": "Full version / 完整版", "reason": "Not available in this preview; use the full version / 预览版暂不开放，请使用完整版"}}}
	raw, _ := json.Marshal(body)
	sum := sha256.Sum256(raw)
	w.Header().Set("ETag", `"`+hex.EncodeToString(sum[:])+`"`)
	s.json(w, 200, body)
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func parseIntDefault(v string, d int) (int, error) {
	if v == "" {
		return d, nil
	}
	return strconv.Atoi(v)
}
func (s *Server) error(w http.ResponseWriter, status int, code, msg string) {
	s.json(w, status, map[string]any{"apiVersion": catalog.APIVersion, "error": map[string]string{"code": code, "message": msg}})
}
func (s *Server) json(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
