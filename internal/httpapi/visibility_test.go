package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const validVisibility = `{"startUtc":"2026-09-23T00:00:00Z","endUtc":"2026-09-24T00:00:00Z","bodyId":"sun","station":{"longitudeDeg":103.851959,"latitudeDeg":1.29027,"heightMeters":0},"minAltitudeDeg":0}`

func TestVisibilityHTTPBoundsAndMissingConfiguration(t *testing.T) {
	s := testServer(t)
	for _, body := range []string{`null`, `{}`, validVisibility + ` {}`, strings.Replace(validVisibility, `"minAltitudeDeg":0`, `"minAltitudeDeg":null`, 1), strings.Replace(validVisibility, `"heightMeters":0`, `"heightMeters":null`, 1), strings.Replace(validVisibility, `2026-09-24`, `2026-09-25`, 1), strings.Replace(validVisibility, `"minAltitudeDeg":0`, `"minAltitudeDeg":91`, 1), strings.Replace(validVisibility, `"minAltitudeDeg":0`, `"minAltitudeDeg":0,"maxSunAltitudeDeg":-91`, 1), strings.Replace(validVisibility, `"minAltitudeDeg":0`, `"minAltitudeDeg":0,"atmosphere":{}`, 1), validVisibility + strings.Repeat(" ", 16384)} {
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/observation/windows", strings.NewReader(body)))
		if rr.Code != 400 {
			t.Fatalf("%d %s", rr.Code, rr.Body.String())
		}
	}
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/observation/windows", strings.NewReader(validVisibility)))
	if rr.Code != 503 || !strings.Contains(rr.Body.String(), "earth_orientation_unavailable") {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
}
