package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestJSONLimitRejectsTruncatedValidPrefix(t *testing.T) {
	for _, suffix := range []string{" ", "{}"} {
		payload := "{}" + strings.Repeat(" ", maxBodyBytes-2) + suffix
		request := httptest.NewRequest("POST", "/v1/state/plan", strings.NewReader(payload))
		var out map[string]any
		if err := decodeOneJSON(request, &out); err == nil {
			t.Fatal("accepted body beyond byte limit")
		}
	}
	request := httptest.NewRequest("POST", "/", strings.NewReader("{}"+strings.Repeat(" ", maxBodyBytes-2)))
	var out map[string]any
	if err := decodeOneJSON(request, &out); err != nil {
		t.Fatalf("rejected exact byte limit: %v", err)
	}
}

func TestStatePlanJSONUsesTheLargerPlanBudget(t *testing.T) {
	payload := `{"ids":["` + strings.Repeat("x", maxBodyBytes) + `"]}`
	request := httptest.NewRequest("POST", "/v1/state/plan", strings.NewReader(payload))
	var out struct {
		IDs []string `json:"ids"`
	}
	if err := decodeOneJSONLimit(request, &out, maxStatePlanBytes); err != nil {
		t.Fatalf("rejected a plan body above the general request limit: %v", err)
	}
	if len(out.IDs) != 1 || len(out.IDs[0]) != maxBodyBytes {
		t.Fatalf("decoded plan IDs = %d rows, first ID bytes = %d", len(out.IDs), len(out.IDs[0]))
	}
}
