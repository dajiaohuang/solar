import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // Several suites read the full original SPK pack. Bound simultaneous
    // copies and I/O instead of scaling these workers to every host CPU.
    maxWorkers: 4,
    coverage: { reporter: ['text', 'html'] },
  },
})
