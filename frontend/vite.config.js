import { defineConfig } from 'vite'

// Dev-only proxy. Locally the backend listens on :3000 (not 8080 — the 8080 in
// the Railway logs is the container-internal mapping), while the Vite dev server
// serves the frontend on its default :5173. The app reaches the backend via the
// absolute VITE_API_URL / VITE_WS_URL (http://localhost:3000), so this proxy is
// belt-and-suspenders for any same-origin/relative requests and for WebSocket
// upgrades on /session/ws.
//
// NOTE: `server.proxy` is ONLY used by the dev server. `vite build` (used by the
// Railway frontend Dockerfile) ignores it entirely, so this never affects prod.
// We intentionally do NOT set server.port here so Vite keeps its default :5173
// and does not collide with the backend already bound to :3000.
const target = process.env.VITE_PROXY_TARGET || 'http://localhost:3000'

export default defineConfig({
  server: {
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
