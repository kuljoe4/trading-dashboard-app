import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = process.env.VITE_PROXY_TARGET || 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/session': { target, ws: true, changeOrigin: true },
      '/settings': { target, changeOrigin: true },
      '/monitoring': { target, changeOrigin: true },
      '/presets': { target, changeOrigin: true },
      '/auth': { target, changeOrigin: true },
      '/healthz': { target, changeOrigin: true },
      '/health': { target, changeOrigin: true },
    },
  },
})

