import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  base: './',
  build: { chunkSizeWarningLimit: 1000 }, // three.js alone is ~600 kB
})
