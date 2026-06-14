import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

export const getHealth = () => api.get('/health')
export const getProviders = () => api.get('/providers')
export const createProvider = (data) => api.post('/providers', data)
export const updateProvider = (id, data) => api.patch(`/providers/${id}`, data)
export const deleteProvider = (id) => api.delete(`/providers/${id}`)
export const testProvider = (id) => api.post(`/providers/${id}/test`)
export const translationTest = (data) => api.post('/translation/test', data)

export const getSessions = () => api.get('/sessions')
export const getSession = (id) => api.get(`/sessions/${id}`)
export const createSession = (data) => api.post('/sessions', data)
export const createChromeTabSession = (data) => api.post('/sessions/from-chrome-tab', data)
export const updateSession = (id, data) => api.patch(`/sessions/${id}`, data)
export const stopSession = (id) => api.post(`/sessions/${id}/stop`)
export const translateInSession = (id, data) => api.post(`/sessions/${id}/translate`, data)
export const getSegments = (id) => api.get(`/sessions/${id}/segments`)

export const startLive = (id) => api.post(`/sessions/${id}/live/start`)
export const stopLive = (id) => api.post(`/sessions/${id}/live/stop`)
export const getAudioStatus = () => api.get('/audio/status')

export const getSettings = () => api.get('/settings')
export const updateSettings = (data) => api.patch('/settings', data)

export const exportSession = (id, format) =>
  api.get(`/sessions/${id}/export`, { params: { format }, responseType: 'blob' })

export default api
