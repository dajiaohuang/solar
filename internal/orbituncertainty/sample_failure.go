package orbituncertainty

// TrajectorySampleError identifies a trajectory-specific numerical/domain
// failure. Source and programming errors must remain whole-job failures.
type TrajectorySampleError struct{ Message string }

func (e *TrajectorySampleError) Error() string { return e.Message }
