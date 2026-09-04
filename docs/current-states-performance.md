# Current-state Web performance contract

The Web adapter sends columnar JSON POSTs with at most 510 IDs. The unit
fixture records each POST's exact ID list, request bytes, response bytes, and
the number of completed frame publications; the 160, 294, and 510 cases must
each produce one POST (two concurrent consumers coalesce to one POST). A
multi-batch request publishes nothing until every batch succeeds.

Run the focused measurement with:

```text
npx vitest run tests/unit/current-states.test.ts
go test ./internal/httpapi -run TestCurrentStateWireShapeSizes -v
go test ./internal/httpapi -bench BenchmarkCurrentStateWireShapes -benchmem
```

The Go benchmark reports columnar JSON wire bytes and allocations for 160,
294, and 510 rows. Client CPU is measured by the test runner around the
coalesced request; the client must retain one atomic store commit per complete
frame set and zero commits for an incomplete set. These are audit metrics, not
production claims: deployers should repeat them against their backend and
network profile.
