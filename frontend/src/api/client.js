import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
})

export const sessionAPI = {
  start: (config) => api.post('/session/start', {
    config,
    paper_mode: config.paper_mode ?? true,
  }),
  stop: () => api.post('/session/stop'),
  status: () => api.get('/session/status'),
  rateLimit: () => api.get('/session/binance/rate-limit'),
  history: () => api.get('/session/history'),
}

export const settingsAPI = {
  getKeys: () => api.get('/settings/keys'),
  updateKeys: (keys) => api.post('/settings/keys', keys),
}

export default api
