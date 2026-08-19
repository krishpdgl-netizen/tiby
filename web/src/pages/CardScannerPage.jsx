import { useState, useRef, useEffect } from 'react'
import { scanCard, confirmContact, draftEmail, sendEmail, transcribeVoice } from '../services/api'
import { useSpeech } from '../hooks/useSpeech'

// ── Status dot states ──────────────────────────────────────
const DOT = { idle: 'idle', active: 'active', done: 'done', warn: 'warn' }

// ── Step states ────────────────────────────────────────────
const STEP = { CARD: 0, VOICE: 1, DRAFT: 2, SENT: 3 }

export default function CardScannerPage() {
  const [step, setStep]           = useState(STEP.CARD)
  const [cardArmed, setCardArmed] = useState(false)
  const [cardDot, setCardDot]     = useState(DOT.idle)
  const [cardStatus, setCardStatus] = useState('Ready to scan')
  const [extracted, setExtracted] = useState({})
  const [imageUrl, setImageUrl]   = useState(null)
  const [savedContact, setSavedContact] = useState(null)
  const [loading, setLoading]     = useState(false)

  // Voice step
  const [recording, setRecording]         = useState(false)
  const [voiceInstruction, setVoiceInstruction] = useState('')

  // Draft step
  const [draft, setDraft]         = useState(null)
  const [sending, setSending]     = useState(false)
  const [sendResult, setSendResult] = useState(null)

  // Refs
  const videoRef    = useRef()
  const previewRef  = useRef()
  const streamRef   = useRef()
  const mrRef       = useRef()
  const chunksRef   = useRef([])

  const { speak, stop, isSpeaking } = useSpeech()

  // ── CARD: open rear camera ────────────────────────────────
  async function handleScanBtn() {
    if (!cardArmed) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        })
        streamRef.current = stream
        videoRef.current.srcObject = stream
        videoRef.current.style.display = 'block'
        previewRef.current.style.display = 'none'
        setCardArmed(true)
      } catch {
        toast('Camera access denied.', 'error')
      }
      return
    }

    // Snap frame → blob
    const cv = document.createElement('canvas')
    cv.width  = videoRef.current.videoWidth
    cv.height = videoRef.current.videoHeight
    cv.getContext('2d').drawImage(videoRef.current, 0, 0)
    cv.toBlob(async blob => {
      previewRef.current.src = URL.createObjectURL(blob)
      previewRef.current.style.display = 'block'
      videoRef.current.style.display = 'none'
      streamRef.current?.getTracks().forEach(t => t.stop())
      setCardArmed(false)
      setCardDot(DOT.active)
      setCardStatus('Reading card…')

      // Upload to backend
      try {
        const file = new File([blob], 'card.jpg', { type: 'image/jpeg' })
        const { data } = await scanCard(file)
        setExtracted(data.extracted || {})
        setImageUrl(data.image_url)
        const count = Object.values(data.extracted || {}).filter(Boolean).length
        setCardDot(DOT.done)
        setCardStatus(count ? `${count} detail${count > 1 ? 's' : ''} extracted — verify below` : 'Card saved — text not readable')
      } catch {
        setCardDot(DOT.warn)
        setCardStatus('Saved offline — could not extract')
      }
    }, 'image/jpeg', 0.92)
  }

  // ── Confirm extracted contact & move to voice ─────────────
  async function handleConfirm() {
    setLoading(true)
    try {
      const { data } = await confirmContact(extracted, imageUrl, {})
      setSavedContact(data.contact)
      setStep(STEP.VOICE)
    } catch {
      toast('Failed to save contact', 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── VOICE: hold to record ─────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mr = new MediaRecorder(stream)
      mrRef.current = mr
      mr.ondataavailable = e => chunksRef.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setLoading(true)
        try {
          const { data } = await transcribeVoice(blob)
          setVoiceInstruction(data.transcript)
        } catch {
          toast('Could not transcribe — type instead', 'warn')
        } finally {
          setLoading(false)
        }
      }
      mr.start()
      setRecording(true)
    } catch {
      toast('Microphone access denied.', 'error')
    }
  }

  function stopRecording() {
    mrRef.current?.stop()
    setRecording(false)
  }

  async function handleDraft() {
    if (!voiceInstruction.trim()) return toast('Tell me what to write first', 'error')
    setLoading(true)
    try {
      const { data } = await draftEmail(savedContact.id, voiceInstruction)
      setDraft(data)
      setStep(STEP.DRAFT)
      setTimeout(() => speak(data.speak_text), 400)
    } catch {
      toast('Failed to draft email', 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── SEND ──────────────────────────────────────────────────
  async function handleSend() {
    stop()
    setSending(true)
    try {
      const { data } = await sendEmail(savedContact.id, draft.subject, draft.body, voiceInstruction)
      setSendResult(data)
      setStep(STEP.SENT)
    } catch {
      toast('Failed to send', 'error')
    } finally {
      setSending(false)
    }
  }

  // ── RESET ─────────────────────────────────────────────────
  function reset() {
    stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    setStep(STEP.CARD)
    setCardArmed(false)
    setCardDot(DOT.idle)
    setCardStatus('Ready to scan')
    setExtracted({})
    setImageUrl(null)
    setSavedContact(null)
    setVoiceInstruction('')
    setDraft(null)
    setSendResult(null)
    if (videoRef.current)  { videoRef.current.style.display  = 'none'; videoRef.current.srcObject = null }
    if (previewRef.current){ previewRef.current.style.display = 'none'; previewRef.current.removeAttribute('src') }
  }

  return (
    <div className="wrap">

      {/* ── STEPPER ── */}
      <div className="stepper">
        {['Card','Email','Done'].map((name, i) => (
          <div key={i} className={`step ${step > i ? 'done' : step === i ? 'active' : ''}`}>
            <div className="step-node">{step > i ? '✓' : i + 1}</div>
            <div className="step-name">{name}</div>
          </div>
        ))}
      </div>

      {/* ── STEP 0: CARD SCAN ── */}
      {step === STEP.CARD && (
        <div className={`lcs-card ${cardDot === DOT.idle ? 'is-active' : cardDot === DOT.done ? 'is-done' : 'is-active'}`}>
          <div className="card-head">
            <div className="card-icon">
              <svg viewBox="0 0 20 14" fill="none" width="20" height="14">
                <rect x="1" y="1" width="18" height="12" rx="2" stroke="#3E7BFA" strokeWidth="1.5"/>
                <rect x="1" y="4.5" width="18" height="2.5" fill="#3E7BFA" opacity=".4"/>
                <rect x="3.5" y="8.5" width="5" height="1.5" rx=".75" fill="#3E7BFA"/>
              </svg>
            </div>
            <div>
              <div className="card-title">Visiting Card</div>
              <div className="card-sub">Scan to extract contact details</div>
            </div>
          </div>

          <div className="video-wrap">
            <video ref={videoRef} autoPlay playsInline muted
              style={{ display: 'none', width: '100%', borderRadius: 12, marginBottom: 12, background: '#000', aspectRatio: '4/3', objectFit: 'cover' }} />
          </div>
          <img ref={previewRef} alt="Card preview"
            style={{ display: 'none', width: '100%', borderRadius: 12, marginBottom: 12, aspectRatio: '4/3', objectFit: 'cover' }} />

          <button
            className={cardDot === DOT.done ? 'btn btn-done' : 'btn btn-scan'}
            onClick={handleScanBtn}
          >
            {cardArmed ? 'Snap Card' : cardDot === DOT.done ? 'Rescan Card' : 'Scan Visiting Card'}
          </button>

          <div className="status-row">
            <span className={`dot ${cardDot}`} />
            <span>{cardStatus}</span>
          </div>

          {/* Extracted fields */}
          {Object.values(extracted).some(Boolean) && (
            <div className="extracted show">
              <div className="extracted-head">Extracted Details</div>
              {[['Name', 'name'], ['Role', 'role'], ['Email', 'email'], ['Phone', 'phone'], ['Company', 'company']].map(([label, key]) =>
                extracted[key] ? (
                  <div key={key} className="ef-row">
                    <span className="ef-key">{label}</span>
                    <span className="ef-val">
                      <input
                        defaultValue={extracted[key]}
                        onChange={e => setExtracted(p => ({ ...p, [key]: e.target.value }))}
                        style={{ border: 'none', background: 'transparent', color: 'inherit', width: '100%', fontSize: 13, padding: 0 }}
                      />
                    </span>
                  </div>
                ) : null
              )}
            </div>
          )}

          {Object.values(extracted).some(Boolean) && (
            <button className="btn btn-submit" style={{ marginTop: 14 }} onClick={handleConfirm} disabled={loading}>
              {loading ? 'Saving…' : 'Save & Write Email →'}
            </button>
          )}
        </div>
      )}

      {/* ── STEP 1: VOICE INSTRUCTION ── */}
      {step === STEP.VOICE && savedContact && (
        <div className="lcs-card is-active">
          <div className="card-head">
            <div className="card-icon" style={{ background: '#E6F7EF' }}>
              <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="#2FA36B" strokeWidth="1.5"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="#2FA36B" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div className="card-title">What should the email say?</div>
              <div className="card-sub">To {savedContact.name || savedContact.email}</div>
            </div>
          </div>

          <button
            className={`btn ${recording ? 'btn-stop' : 'btn-record'}`}
            onMouseDown={startRecording} onMouseUp={stopRecording}
            onTouchStart={startRecording} onTouchEnd={stopRecording}
          >
            {recording ? '● Release to stop' : '🎤 Hold to speak'}
          </button>

          {loading && <div className="status-row"><span className="dot active" /><span>Transcribing…</span></div>}

          <textarea
            style={{ width: '100%', marginTop: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid #DCE6F7', fontSize: 14, fontFamily: 'inherit', minHeight: 80, resize: 'vertical', color: '#1B2A4A' }}
            placeholder="Or type your instruction here…"
            value={voiceInstruction}
            onChange={e => setVoiceInstruction(e.target.value)}
          />

          <button className="btn btn-submit" style={{ marginTop: 12 }} onClick={handleDraft} disabled={loading || !voiceInstruction.trim()}>
            {loading ? 'Drafting…' : 'Draft Email →'}
          </button>

          <button onClick={() => setStep(STEP.CARD)} style={{ marginTop: 8, background: 'none', border: 'none', color: '#5B6472', fontSize: 13, cursor: 'pointer', width: '100%' }}>
            ← Back
          </button>
        </div>
      )}

      {/* ── STEP 2: DRAFT + APPROVE ── */}
      {step === STEP.DRAFT && draft && (
        <div className="lcs-card is-active">
          <div className="card-head">
            <div className="card-icon">
              <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="#3E7BFA" strokeWidth="1.5"/>
                <path d="M3 9l9 6 9-6" stroke="#3E7BFA" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div className="card-title">Email Draft</div>
              <div className="card-sub">{isSpeaking ? 'Reading aloud…' : 'Review and send'}</div>
            </div>
          </div>

          {/* TTS status */}
          <div className="status-row">
            <span className={`dot ${isSpeaking ? 'active' : 'done'}`} />
            <span style={{ flex: 1 }}>{isSpeaking ? 'Playing draft…' : 'Ready to send'}</span>
            <button onClick={isSpeaking ? stop : () => speak(draft.speak_text)}
              style={{ fontSize: 12, color: '#3E7BFA', background: 'none', border: 'none', cursor: 'pointer', padding: 0, width: 'auto', marginTop: 0 }}>
              {isSpeaking ? 'Stop' : '▶ Replay'}
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#5B6472', display: 'block', marginBottom: 4 }}>SUBJECT</label>
            <input
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #DCE6F7', fontSize: 14, color: '#1B2A4A' }}
              value={draft.subject}
              onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#5B6472', display: 'block', marginBottom: 4 }}>BODY</label>
            <textarea
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #DCE6F7', fontSize: 14, fontFamily: 'inherit', minHeight: 160, resize: 'vertical', color: '#1B2A4A' }}
              value={draft.body}
              onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
            />
          </div>

          <button className="btn btn-submit" style={{ marginTop: 12 }} onClick={handleSend} disabled={sending}>
            {sending ? 'Sending…' : '✉ Send Email'}
          </button>
          <button onClick={() => { stop(); setStep(STEP.VOICE) }}
            style={{ marginTop: 8, background: 'none', border: 'none', color: '#5B6472', fontSize: 13, cursor: 'pointer', width: '100%' }}>
            ← Edit instruction
          </button>
        </div>
      )}

      {/* ── STEP 3: SENT ── */}
      {step === STEP.SENT && sendResult && (
        <div className="lcs-card is-done">
          {sendResult.method === 'gmail' ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div className="card-title">Email sent!</div>
              <div className="card-sub" style={{ marginTop: 4 }}>Delivered to {savedContact?.name}</div>
            </div>
          ) : (
            <div>
              <div className="card-head">
                <div className="card-icon" style={{ background: '#FFF6E5' }}>
                  <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                    <circle cx="12" cy="12" r="9" stroke="#F59E0B" strokeWidth="1.5"/>
                    <path d="M12 8v4M12 16h.01" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <div>
                  <div className="card-title">Gmail not connected</div>
                  <div className="card-sub">Use one of these to send</div>
                </div>
              </div>
              <a href={sendResult.mailto} className="btn btn-submit" style={{ display: 'flex', textDecoration: 'none', marginBottom: 8 }}>
                📧 Open in Mail App
              </a>
              <button onClick={() => { navigator.clipboard.writeText(draft.body); toast('Copied!', 'success') }}
                className="btn" style={{ background: '#5B6472' }}>
                Copy Email Body
              </button>
              <div style={{ marginTop: 12, padding: 12, background: '#F4FBF7', borderRadius: 10, fontSize: 12.5, color: '#1B2A4A' }}>
                <div><strong>To:</strong> {sendResult.to}</div>
                <div style={{ marginTop: 4 }}><strong>Subject:</strong> {sendResult.subject}</div>
              </div>
            </div>
          )}
          <button className="btn btn-scan" style={{ marginTop: 16 }} onClick={reset}>
            Scan Another Card
          </button>
        </div>
      )}

    </div>
  )
}

// ── Toast (simple DOM toast matching LCS style) ─────────────
function toast(msg, type = 'info') {
  let el = document.getElementById('tiby-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'tiby-toast'
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(10px);background:#1B2A4A;color:#fff;padding:12px 22px;border-radius:12px;font-size:13.5px;font-weight:500;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:9999;max-width:88vw;text-align:center;box-shadow:0 4px 20px rgba(27,42,74,.25)'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.style.background = type === 'error' ? '#D65A56' : type === 'success' ? '#2FA36B' : '#1B2A4A'
  el.style.opacity = '1'
  el.style.transform = 'translateX(-50%) translateY(0)'
  clearTimeout(el._t)
  el._t = setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(10px)' }, 3200)
}
