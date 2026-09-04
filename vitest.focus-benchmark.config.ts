import { defineConfig } from 'vitest/config'

export default defineConfig({ test: {
  environment: 'node', include: ['tests/performance/focus-throughput.test.ts'], maxWorkers: 1,
} })
