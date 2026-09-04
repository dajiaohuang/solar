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
294, and 510 rows. The focused Web test prints request count, request bytes,
response bytes, and elapsed client validation/build time for each case. It
also records one completed publication for each complete response and zero
publications when any batch fails. The elapsed value is a repeatable test-run
measurement, not a machine-independent CPU baseline; deployers should repeat
it against their backend and network profile.
