import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  root: 'client',
  build: {
    outDir: '../client/dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Proxy API calls to the Express server during development
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
})
