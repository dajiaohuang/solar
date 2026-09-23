package main

import "testing"

func TestRequestRequiresExplicitStation(t *testing.T) {
	for _, raw := range []string{`{}`, `{"station":{"longitudeDeg":0,"latitudeDeg":0}}`, `{"station":{"longitudeDeg":null,"latitudeDeg":0,"heightMeters":0}}`, `{"station":{"longitudeDeg":0,"latitudeDeg":0,"heightMeters":0},"typo":1}`, `{} {}`} {
		if _, err := parseRequest([]byte(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	if _, err := parseRequest([]byte(`{"station":{"longitudeDeg":0,"latitudeDeg":0,"heightMeters":0}}`)); err != nil {
		t.Fatal(err)
	}
}
