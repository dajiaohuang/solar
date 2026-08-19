import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

type BuildInfo = {
  version: string
  commitSha: string
  buildTime: string
  environment: string
  datasetVersion: string | null
}

function loadBuildInfo(): BuildInfo {
  const cachePath = resolve('.cache/solar-build-info.json')
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8')) as BuildInfo
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
  let commitSha = 'unknown'
  try { commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { /* Git is optional in packaged builds. */ }
  return {
    version: packageJson.version,
    commitSha,
    buildTime: new Date().toISOString(),
    environment: 'development',
    datasetVersion: null,
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: '/solar/',
  publicDir: command === 'serve' ? 'public' : false,
  define: { __SOLAR_BUILD_INFO__: JSON.stringify(loadBuildInfo()) },
  // Three.js is isolated in a lazy renderer chunk; 600 kB keeps the build
  // warning meaningful without flagging that deliberate route boundary.
  build: { chunkSizeWarningLimit: 600 },
}))
