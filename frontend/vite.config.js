import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:3000'
const disableProxy = process.env.VITE_DISABLE_PROXY === 'true'

// Helper to bypass proxy for HTML browser navigation so SPA routes don't loop
const htmlBypass = (req) => {
  if (req.headers && req.headers.accept && req.headers.accept.includes('text/html')) {
    return '/index.html'
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    minify: 'esbuild',
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    hmr: false,
    proxy: disableProxy ? false : {
      '/session': { target, ws: true, changeOrigin: true, bypass: htmlBypass },
      '/settings': { target, changeOrigin: true, bypass: htmlBypass },
      '/monitoring': { target, changeOrigin: true, bypass: htmlBypass },
      '/presets': { target, changeOrigin: true, bypass: htmlBypass },
      '/auth': { target, changeOrigin: true, bypass: htmlBypass },
      '/healthz': { target, changeOrigin: true, bypass: htmlBypass },
      '/health': { target, changeOrigin: true, bypass: htmlBypass },
    },
  },
})

