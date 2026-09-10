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
