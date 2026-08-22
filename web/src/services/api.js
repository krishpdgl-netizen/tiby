import axios from 'axios'
import { supabase } from './supabase'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'
const api = axios.create({ baseURL: BASE, timeout: 120000 })

api.interceptors.request.use(async config => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) config.headers.Authorization = `Bearer ${session.access_token}`
  return config
})

api.interceptors.response.use(
  r => r,
  async error => {
    if (error?.response?.status === 401) {
      await supabase.auth.refreshSession().catch(() => {})
      // Invalidate cache on auth error
      _invalidateCache()
    }
    return Promise.reject(error)
  }
)

// ── Simple in-memory cache for GET requests ──────────────────────────────────
const _cache = {}
const _TTL = { contacts: 60000, tasks: 30000, meetings: 60000, analytics: 30000, followups: 120000 }

function _cached(key, fn, ttl) {
  const now = Date.now()
  if (_cache[key] && now - _cache[key].t < ttl) return Promise.resolve(_cache[key].v)
  return fn().then(v => { _cache[key] = { v, t: now }; return v })
}

function _bust(key) { delete _cache[key] }
function _invalidateCache() { Object.keys(_cache).forEach(k => delete _cache[k]) }

// Expose cache bust for mutations
export const bustCache = _bust

// ── API calls ─────────────────────────────────────────────────────────────────
export const agentChat           = (message, history = []) => api.post('/agent/chat', { message, history })

export const scanCard            = imageFile => { const f = new FormData(); f.append('file', imageFile); return api.post('/contacts/scan-card', f) }
export const confirmContact      = async (extracted, imagePath, edits = {}) => {
  const r = await api.post('/contacts/confirm', { extracted, image_path: imagePath, edits })
  _bust('contacts'); return r
}
export const listContacts        = () => _cached('contacts', () => api.get('/contacts/'), _TTL.contacts)
export const getContact          = id => api.get(`/contacts/${id}`)
export const deleteContact       = async id => { const r = await api.delete(`/contacts/${id}`); _bust('contacts'); return r }

export const draftEmail          = (contactId, voiceInstruction) => api.post('/emails/draft', { contact_id: contactId, voice_instruction: voiceInstruction })
export const draftQuickEmail     = (contact, voiceInstruction) => api.post('/emails/draft-quick', { contact, voice_instruction: voiceInstruction })
export const sendEmail           = (contactId, subject, body, voiceInstruction) => api.post('/emails/send', { contact_id: contactId, subject, body, voice_instruction: voiceInstruction })
export const sendQuickEmail      = (toEmail, subject, body) => api.post('/emails/send-quick', { to_email: toEmail, subject, body })
export const getGmailAuthUrl     = () => api.get('/emails/auth/url')
export const getGmailStatus      = () => api.get('/emails/auth/status')

export const startMeeting        = title => api.post('/meetings/start', { title })
export const uploadMeetingAudio  = async (id, blob) => {
  const f = new FormData(); f.append('file', blob, 'recording.webm')
  const r = await api.post(`/meetings/${id}/upload`, f)
  _bust('meetings'); return r
}
export const listMeetings        = () => _cached('meetings', () => api.get('/meetings/'), _TTL.meetings)
export const getMeeting          = id => api.get(`/meetings/${id}`)
export const processMeetingNotes = async (imageFile, title) => {
  const f = new FormData(); f.append('file', imageFile, 'notes.jpg')
  const r = await api.post(`/meetings/notes?title=${encodeURIComponent(title || 'Meeting')}`, f)
  _bust('meetings'); return r
}

export const listTasks           = () => _cached('tasks', () => api.get('/tasks/'), _TTL.tasks)
export const createTask          = async body => { const r = await api.post('/tasks/', body); _bust('tasks'); _bust('analytics'); return r }
export const completeTask        = async id => { const r = await api.patch(`/tasks/${id}/complete`); _bust('tasks'); _bust('analytics'); return r }
export const reopenTask          = async id => { const r = await api.patch(`/tasks/${id}/reopen`); _bust('tasks'); _bust('analytics'); return r }

export const transcribeVoice     = blob => { const f = new FormData(); f.append('file', blob, 'voice.webm'); return api.post('/voice/transcribe', f) }

export const getAnalytics        = () => _cached('analytics', () => api.get('/analytics/summary'), _TTL.analytics)
export const getFollowups        = () => _cached('followups', () => api.get('/analytics/followups'), _TTL.followups)
export const prioritizeTasks     = () => api.post('/analytics/prioritize')
export const generateEOD         = () => api.post('/analytics/eod')

export const getProfile          = () => api.get('/profile/')
export const updateProfile       = data => api.patch('/profile/', data)

export default api
