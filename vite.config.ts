import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/solar/',
  // Three.js is isolated in a lazy renderer chunk; 600 kB keeps the build
  // warning meaningful without flagging that deliberate route boundary.
  build: { chunkSizeWarningLimit: 600 },
})
