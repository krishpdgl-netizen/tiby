import { useState, useRef } from 'react'
import { Camera, Mic, MicOff, Send, Check, Loader2, User, Copy, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import { scanCard, confirmContact, draftEmail, sendEmail, transcribeVoice } from '../services/api'
import { useSpeech } from '../hooks/useSpeech'

const STEP = {
  CAPTURE: 'capture',
  REVIEW: 'review',
  VOICE: 'voice',
  DRAFT: 'draft',
  SENT: 'sent',
}

export default function CardScannerPage() {
  const [step, setStep] = useState(STEP.CAPTURE)
  const [loading, setLoading] = useState(false)
  const [imagePreview, setImagePreview] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const [imageUrl, setImageUrl] = useState(null)
  const [extracted, setExtracted] = useState(null)
  const [edits, setEdits] = useState({})
  const [savedContact, setSavedContact] = useState(null)
  const [voiceInstruction, setVoiceInstruction] = useState('')
  const [draft, setDraft] = useState(null)
  const [sendResult, setSendResult] = useState(null)
  const [recording, setRecording] = useState(false)

  const fileInputRef = useRef()
  const mediaRecorderRef = useRef()
  const audioChunksRef = useRef([])
  const { speak, stop, isSpeaking } = useSpeech()

  // ── Step 1: Capture ────────────────────────────────────────
  const handleImageSelect = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    setLoading(true)
    try {
      const { data } = await scanCard(file)
      setExtracted(data.extracted)
      setImageUrl(data.image_url)
      setEdits({})
      setStep(STEP.REVIEW)
    } catch {
      toast.error('Could not scan card — try a clearer photo')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: Review ────────────────────────────────────────
  const handleConfirm = async () => {
    setLoading(true)
    try {
      const { data } = await confirmContact(extracted, imageUrl, edits)
      setSavedContact(data.contact)
      toast.success(`${data.contact.name || 'Contact'} saved!`)
      setStep(STEP.VOICE)
    } catch {
      toast.error('Failed to save contact')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 3: Voice instruction ──────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []
      const mr = new MediaRecorder(stream)
      mediaRecorderRef.current = mr
      mr.ondataavailable = (e) => audioChunksRef.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        setLoading(true)
        try {
          const { data } = await transcribeVoice(blob)
          setVoiceInstruction(data.transcript)
        } catch {
          toast.error('Could not transcribe — type your instruction instead')
        } finally {
          setLoading(false)
        }
      }
      mr.start()
      setRecording(true)
    } catch {
      toast.error('Microphone access denied')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  const handleDraft = async () => {
    if (!voiceInstruction.trim()) return toast.error('Tell me what to write first')
    setLoading(true)
    try {
      const { data } = await draftEmail(savedContact.id, voiceInstruction)
      setDraft(data)
      setStep(STEP.DRAFT)
      // Speak the draft aloud using browser TTS
      setTimeout(() => speak(data.speak_text), 400)
    } catch {
      toast.error('Failed to draft email')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 4: Approve & send ────────────────────────────────
  const handleSend = async () => {
    stop() // stop TTS if still playing
    setLoading(true)
    try {
      const { data } = await sendEmail(
        savedContact.id, draft.subject, draft.body, voiceInstruction
      )
      setSendResult(data)
      setStep(STEP.SENT)
      if (data.method === 'gmail') {
        toast.success('Email sent via Gmail!')
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const handleReplay = () => speak(draft.speak_text)

  const reset = () => {
    stop()
    setStep(STEP.CAPTURE)
    setImagePreview(null)
    setExtracted(null)
    setDraft(null)
    setSendResult(null)
    setVoiceInstruction('')
    setSavedContact(null)
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Card Scanner</h1>
      <StepBar current={step} />

      {/* ── CAPTURE ── */}
      {step === STEP.CAPTURE && (
        <div className="border-2 border-dashed border-gray-300 rounded-2xl p-10 text-center space-y-4">
          <Camera className="mx-auto text-gray-400" size={48} />
          <p className="text-gray-600">Take a photo of a business card</p>
          <button onClick={() => fileInputRef.current.click()} className="btn-primary" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" size={18} /> : 'Upload / Take Photo'}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
            className="hidden" onChange={handleImageSelect} />
        </div>
      )}

      {/* ── REVIEW ── */}
      {step === STEP.REVIEW && extracted && (
        <div className="space-y-4">
          {imagePreview && (
            <img src={imagePreview} className="w-full rounded-xl object-cover max-h-48" alt="Card" />
          )}
          <p className="text-sm text-gray-500">Review and edit the extracted info</p>
          {[['name','Full Name'],['company','Company'],['role','Role / Title'],
            ['email','Email'],['phone','Phone'],['website','Website']].map(([key, label]) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 mb-1">{label}</label>
              <input className="input" defaultValue={extracted[key] || ''}
                onChange={(e) => setEdits(p => ({ ...p, [key]: e.target.value }))} />
            </div>
          ))}
          <button onClick={handleConfirm} className="btn-primary w-full" disabled={loading}>
            {loading ? <Loader2 className="animate-spin mx-auto" size={18} /> : 'Save Contact →'}
          </button>
        </div>
      )}

      {/* ── VOICE ── */}
      {step === STEP.VOICE && savedContact && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl">
            <User size={20} className="text-green-600" />
            <div>
              <p className="font-medium text-sm">{savedContact.name}</p>
              <p className="text-xs text-gray-500">{savedContact.company}</p>
            </div>
          </div>
          <p className="text-sm text-gray-600">What should I write in the email?</p>
          <div className="flex gap-2">
            <button
              onMouseDown={startRecording} onMouseUp={stopRecording}
              onTouchStart={startRecording} onTouchEnd={stopRecording}
              className={`p-3 rounded-xl ${recording ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              {recording ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <input className="input flex-1" placeholder="Hold mic to speak, or type here..."
              value={voiceInstruction} onChange={(e) => setVoiceInstruction(e.target.value)} />
          </div>
          {recording && <p className="text-xs text-red-500 animate-pulse">Recording… release to stop</p>}
          <button onClick={handleDraft} className="btn-primary w-full"
            disabled={loading || !voiceInstruction.trim()}>
            {loading ? <Loader2 className="animate-spin mx-auto" size={18} /> : 'Draft Email →'}
          </button>
        </div>
      )}

      {/* ── DRAFT ── */}
      {step === STEP.DRAFT && draft && (
        <div className="space-y-4">
          {/* TTS controls */}
          <div className="flex items-center gap-2 bg-indigo-50 rounded-xl p-3">
            <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-indigo-500 animate-pulse' : 'bg-gray-300'}`} />
            <span className="text-xs text-gray-600 flex-1">
              {isSpeaking ? 'Reading aloud…' : 'Draft ready'}
            </span>
            <button onClick={isSpeaking ? stop : handleReplay}
              className="text-xs text-indigo-600 hover:underline">
              {isSpeaking ? 'Stop' : '▶ Replay'}
            </button>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Subject</label>
            <input className="input" value={draft.subject}
              onChange={(e) => setDraft(d => ({ ...d, subject: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Body</label>
            <textarea className="input min-h-[180px] resize-y" value={draft.body}
              onChange={(e) => setDraft(d => ({ ...d, body: e.target.value }))} />
          </div>

          <div className="flex gap-3">
            <button onClick={() => { stop(); setStep(STEP.VOICE) }} className="btn-secondary flex-1">
              ← Edit
            </button>
            <button onClick={handleSend} className="btn-primary flex-1" disabled={loading}>
              {loading
                ? <Loader2 className="animate-spin mx-auto" size={18} />
                : <span className="flex items-center justify-center gap-2"><Send size={16} /> Send</span>}
            </button>
          </div>
        </div>
      )}

      {/* ── SENT ── */}
      {step === STEP.SENT && sendResult && (
        <div className="space-y-4">
          {sendResult.method === 'gmail' ? (
            <div className="text-center space-y-4 py-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <Check className="text-green-600" size={32} />
              </div>
              <p className="font-semibold">Email sent via Gmail!</p>
              <p className="text-sm text-gray-500">{savedContact?.name} will receive your message.</p>
            </div>
          ) : (
            /* Manual send fallback */
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="font-medium text-amber-800 text-sm">Gmail not connected yet</p>
                <p className="text-xs text-amber-700 mt-1">
                  Use one of the options below to send the email. Connect Gmail in Settings to send automatically next time.
                </p>
              </div>

              {/* mailto button */}
              <a href={sendResult.mailto} className="btn-primary w-full flex items-center justify-center gap-2">
                <Mail size={16} /> Open in Mail App
              </a>

              {/* Copy body */}
              <div className="card space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 font-medium">TO</span>
                  <span className="text-sm">{sendResult.to}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 font-medium">SUBJECT</span>
                  <span className="text-sm">{sendResult.subject}</span>
                </div>
                <div className="border-t border-gray-100 pt-2">
                  <p className="text-xs text-gray-500 mb-1">BODY</p>
                  <p className="text-sm text-gray-700 whitespace-pre-line">{sendResult.body}</p>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(sendResult.body)
                    toast.success('Body copied!')
                  }}
                  className="btn-secondary w-full flex items-center justify-center gap-2 text-sm"
                >
                  <Copy size={14} /> Copy Email Body
                </button>
              </div>
            </div>
          )}

          <button onClick={reset} className="btn-secondary w-full">Scan another card</button>
        </div>
      )}
    </div>
  )
}

function StepBar({ current }) {
  const steps = [STEP.CAPTURE, STEP.REVIEW, STEP.VOICE, STEP.DRAFT, STEP.SENT]
  const idx = steps.indexOf(current)
  return (
    <div className="flex gap-1">
      {steps.map((_, i) => (
        <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= idx ? 'bg-indigo-500' : 'bg-gray-200'}`} />
      ))}
    </div>
  )
}
