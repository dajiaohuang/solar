# Unified Go backend workstream

The implementation in `cmd/solar-backend` is a local service shared by Web,
Android and iOS. See [`docs/backend-api-v1.md`](../docs/backend-api-v1.md) for
the versioned scientific contract.

Run from the repository root with `go run ./cmd/solar-backend`. Use
`-data-dir src/data` (the full manifest is selected automatically) and,
optionally, `-inventory-dir` for the audited gzip-JSONL source inventory. The
inventory endpoint is deliberately separate from the deduplicated catalog and
preserves source-record identity, parent, geometry and ephemeris status.
