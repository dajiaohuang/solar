package inventory

import (
	"context"
	"strconv"
	"testing"
)

func BenchmarkGetManyVsIndividualGet(b *testing.B) {
	for _, count := range []int{510, 16384, 32768} {
		b.Run(strconv.Itoa(count), func(b *testing.B) {
			i, ids := benchmarkInventory(b, count)
			b.Run("individual", func(b *testing.B) {
				b.ReportAllocs()
				b.ResetTimer()
				for n := 0; n < b.N; n++ {
					for _, id := range ids {
						if _, found, err := i.Get(context.Background(), id); err != nil || !found {
							b.Fatal(err)
						}
					}
				}
			})
			b.Run("grouped", func(b *testing.B) {
				b.ReportAllocs()
				b.ResetTimer()
				for n := 0; n < b.N; n++ {
					rows, err := i.GetMany(context.Background(), ids)
					if err != nil || len(rows) != len(ids) {
						b.Fatalf("rows=%d err=%v", len(rows), err)
					}
				}
			})
		})
	}
}

func benchmarkInventory(b *testing.B, count int) (*Inventory, []string) {
	b.Helper()
	d := b.TempDir()
	ids := make([]string, count)
	rows := make([]string, count)
	for n := 0; n < count; n++ {
		id := "sb:benchmark:" + strconv.Itoa(n)
		ids[n] = id
		rows[n] = `{"id":"` + id + `","source":"numbered"}`
	}
	shards := make([][]string, 0, (count+9999)/10000)
	for start := 0; start < len(rows); start += 10000 {
		end := start + 10000
		if end > len(rows) {
			end = len(rows)
		}
		shards = append(shards, rows[start:end])
	}
	writeAddressableInventory(b, d, shards)
	i, err := Load(d)
	if err != nil {
		b.Fatal(err)
	}
	return i, ids
}
