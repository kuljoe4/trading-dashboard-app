import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3000' : ''),
})

export const sessionAPI = {
  start: (config, paperMode, sessionId) => api.post('/session/start', {
    config,
    paper_mode: paperMode ?? true,
    sessionId,
  }),
  stop: () => api.post('/session/stop'),
  status: () => api.get('/session/status'),
  list: () => api.get('/session/list'),
  update: (id, config) => api.patch(`/session/${id}`, { config }),
  pause: (paused) => api.post('/session/pause', { paused }),
  delete: (id) => api.delete(`/session/${id}`),
  rateLimit: () => api.get('/session/binance/rate-limit'),
  history: () => api.get('/session/history'),
  closeTrade: (symbol) => api.post(`/session/trade/${symbol}/close`),
}

export const settingsAPI = {
  getKeys: () => api.get('/settings/keys'),
  updateKeys: (keys) => api.post('/settings/keys', keys),
}

export default api
