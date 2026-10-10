package orbituncertainty

import (
	"encoding/json"
	"strconv"
	"testing"
)

var orbitalCovarianceLabels = []string{"e", "q", "tp", "node", "peri", "i"}

func indexedModel(name, kind string, index int) map[string]any {
	return map[string]any{"name": name, "kind": kind, "n": json.Number(strconv.Itoa(index))}
}

func TestValidateCovarianceModelParameterAxes(t *testing.T) {
	t.Run("accepts estimated axes in n order with considered gaps", func(t *testing.T) {
		labels := append(append([]string(nil), orbitalCovarianceLabels...), "A1", "A2")
		models := map[string]map[string]any{
			"A1":         indexedModel("A1", "EST", 1),
			"considered": indexedModel("considered", "CON", 2),
			"A2":         indexedModel("A2", "EST", 3),
			"fixed":      indexedModel("fixed", "SET", 0),
		}
		if err := validateCovarianceModelParameterAxes(labels, models); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("rejects source label order that conflicts with n", func(t *testing.T) {
		labels := append(append([]string(nil), orbitalCovarianceLabels...), "A2", "A1")
		models := map[string]map[string]any{"A1": indexedModel("A1", "EST", 1), "A2": indexedModel("A2", "EST", 2)}
		if err := validateCovarianceModelParameterAxes(labels, models); err == nil {
			t.Fatal("accepted covariance axes in the wrong source order")
		}
	})

	t.Run("rejects duplicate fitted indices", func(t *testing.T) {
		labels := append(append([]string(nil), orbitalCovarianceLabels...), "A1")
		models := map[string]map[string]any{"A1": indexedModel("A1", "EST", 1), "A2": indexedModel("A2", "CON", 1)}
		if err := validateCovarianceModelParameterAxes(labels, models); err == nil {
			t.Fatal("accepted duplicate estimated/considered parameter indices")
		}
	})
}
