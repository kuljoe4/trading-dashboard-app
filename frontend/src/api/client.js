import axios from 'axios'

const api = axios.create({
  baseURL: 'http://localhost:8000/api',
})

export const sessionAPI = {
  start: (config) => api.post('/session/start', config),
  stop: () => api.post('/session/stop'),
  status: () => api.get('/session/status'),
}

export const settingsAPI = {
  getKeys: () => api.get('/settings/keys'),
  updateKeys: (keys) => api.post('/settings/keys', keys),
}

export default api
