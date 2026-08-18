import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

const api = axios.create({ baseURL: BASE })

// ── Contacts ──────────────────────────────────────────────────
export const scanCard = (imageFile) => {
  const form = new FormData()
  form.append('file', imageFile)
  return api.post('/contacts/scan-card', form)
}

export const confirmContact = (extracted, imageUrl, edits = {}) =>
  api.post('/contacts/confirm', { extracted, image_url: imageUrl, edits })

export const listContacts = () => api.get('/contacts/')

export const getContact = (id) => api.get(`/contacts/${id}`)

// ── Email ────────────────────────────────────────────────────
export const draftEmail = (contactId, voiceInstruction) =>
  api.post('/emails/draft', {
    contact_id: contactId,
    voice_instruction: voiceInstruction,
  })

export const sendEmail = (contactId, subject, body, voiceInstruction) =>
  api.post('/emails/send', {
    contact_id: contactId,
    subject,
    body,
    voice_instruction: voiceInstruction,
  })

export const getGmailAuthUrl = () => api.get('/emails/auth/url')

// ── Meetings ────────────────────────────────────────────────
export const startMeeting = (title) =>
  api.post('/meetings/start', { title })

export const uploadMeetingAudio = (meetingId, audioBlob) => {
  const form = new FormData()
  form.append('file', audioBlob, 'recording.webm')
  return api.post(`/meetings/${meetingId}/upload`, form)
}

export const listMeetings = () => api.get('/meetings/')

export const getMeeting = (id) => api.get(`/meetings/${id}`)

// ── Voice ────────────────────────────────────────────────────
export const transcribeVoice = (audioBlob) => {
  const form = new FormData()
  form.append('file', audioBlob, 'voice.webm')
  return api.post('/voice/transcribe', form)
}
