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
    if (error?.response?.status === 401) await supabase.auth.refreshSession().catch(() => {})
    return Promise.reject(error)
  }
)

export const agentChat           = (message, history = []) => api.post('/agent/chat', { message, history })
export const scanCard            = imageFile => { const f = new FormData(); f.append('file', imageFile); return api.post('/contacts/scan-card', f) }
export const confirmContact      = (extracted, imagePath, edits = {}) => api.post('/contacts/confirm', { extracted, image_path: imagePath, edits })
export const listContacts        = () => api.get('/contacts/')
export const getContact          = id => api.get(`/contacts/${id}`)
export const deleteContact       = id => api.delete(`/contacts/${id}`)
export const draftEmail          = (contactId, voiceInstruction) => api.post('/emails/draft', { contact_id: contactId, voice_instruction: voiceInstruction })
export const draftQuickEmail     = (contact, voiceInstruction) => api.post('/emails/draft-quick', { contact, voice_instruction: voiceInstruction })
export const sendEmail           = (contactId, subject, body, voiceInstruction) => api.post('/emails/send', { contact_id: contactId, subject, body, voice_instruction: voiceInstruction })
export const sendQuickEmail      = (toEmail, subject, body) => api.post('/emails/send-quick', { to_email: toEmail, subject, body })
export const getGmailAuthUrl     = () => api.get('/emails/auth/url')
export const getGmailStatus      = () => api.get('/emails/auth/status')
export const startMeeting        = title => api.post('/meetings/start', { title })
export const uploadMeetingAudio  = (id, blob) => { const f = new FormData(); f.append('file', blob, 'recording.webm'); return api.post(`/meetings/${id}/upload`, f) }
export const listMeetings        = () => api.get('/meetings/')
export const getMeeting          = id => api.get(`/meetings/${id}`)
export const processMeetingNotes = (imageFile, title) => { const f = new FormData(); f.append('file', imageFile, 'notes.jpg'); return api.post(`/meetings/notes?title=${encodeURIComponent(title || 'Meeting')}`, f) }
export const listTasks           = () => api.get('/tasks/')
export const createTask          = body => api.post('/tasks/', body)
export const completeTask        = id => api.patch(`/tasks/${id}/complete`)
export const reopenTask          = id => api.patch(`/tasks/${id}/reopen`)
export const transcribeVoice     = blob => { const f = new FormData(); f.append('file', blob, 'voice.webm'); return api.post('/voice/transcribe', f) }
export const getAnalytics        = () => api.get('/analytics/summary')
export const getFollowups        = () => api.get('/analytics/followups')
export const prioritizeTasks     = () => api.post('/analytics/prioritize')
export const generateEOD         = () => api.post('/analytics/eod')
export const getProfile          = () => api.get('/profile/')
export const updateProfile       = data => api.patch('/profile/', data)

export default api
