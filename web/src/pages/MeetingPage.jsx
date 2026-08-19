import { useState, useRef } from 'react'
import { useSpeech } from '../hooks/useSpeech'

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ""
const API_URL = import.meta.env.VITE_API_URL || "https://tiby.onrender.com/api/v1"

const DOT = { idle: 'idle', active: 'active', done: 'done', warn: 'warn' }

export default function MeetingPage() {
  const [title, setTitle]       = useState('')
  const [mode, setMode]         = useState(null)   // 'notes' | 'record' | null
  const [result, setResult]     = useState(null)
  const [loading, setLoading]   = useState(false)
  const [status, setStatus]     = useState('')
  const [statusDot, setStatusDot] = useState(DOT.idle)

  // Notes scan
  const [noteArmed, setNoteArmed]     = useState(false)
  const [notePreview, setNotePreview] = useState(null)

  // Recording
  const [recording, setRecording]   = useState(false)
  const [elapsed, setElapsed]       = useState(0)

  const videoRef    = useRef()
  const streamRef   = useRef()
  const mrRef       = useRef()
  const chunksRef   = useRef([])
  const timerRef    = useRef()

  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader()
      r.onload  = () => res(r.result.split(',')[1])
      r.onerror = rej
      r.readAsDataURL(blob)
    })
  }

  function resizeImage(sourceCanvas, maxPx = 1280) {
    return new Promise(resolve => {
      const scale = Math.min(maxPx / sourceCanvas.width, maxPx / sourceCanvas.height, 1)
      const out   = document.createElement('canvas')
      out.width   = Math.round(sourceCanvas.width  * scale)
      out.height  = Math.round(sourceCanvas.height * scale)
      out.getContext('2d').drawImage(sourceCanvas, 0, 0, out.width, out.height)
      out.toBlob(resolve, 'image/jpeg', 0.8)
    })
  }

  // ── NOTES: open camera ──────────────────────────────────────────────────────
  async function handleNotesCamera() {
    if (!noteArmed) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        })
        streamRef.current = stream
        videoRef.current.srcObject = stream
        videoRef.current.style.display = 'block'
        setNoteArmed(true)
      } catch {
        showToast('Camera access denied', 'error')
      }
      return
    }

    // Snap
    const cv = document.createElement('canvas')
    cv.width  = videoRef.current.videoWidth
    cv.height = videoRef.current.videoHeight
    cv.getContext('2d').drawImage(videoRef.current, 0, 0)
    streamRef.current?.getTracks().forEach(t => t.stop())
    setNoteArmed(false)
    videoRef.current.style.display = 'none'

    const blob = await resizeImage(cv)
    setNotePreview(URL.createObjectURL(blob))

    setStatusDot(DOT.active)
    setStatus('Reading handwritten notes…')
    setLoading(true)

    try {
      const b64 = await blobToBase64(blob)
      const res  = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action:         'scan-notes',
          image_base64:   b64,
          image_mime:     'image/jpeg',
          meeting_title:  title || 'Meeting',
        }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        setResult(data)
        setStatusDot(DOT.done)
        setStatus('Minutes ready')
      } else {
        throw new Error(data.message)
      }
    } catch (e) {
      setStatusDot(DOT.warn)
      setStatus('Could not process notes — try again')
      showToast('Failed: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── RECORD: start / stop ────────────────────────────────────────────────────
  async function startRecording() {
    if (!title.trim()) return showToast('Enter a meeting title first', 'error')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mrRef.current = mr
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(1000)
      setRecording(true)
      setElapsed(0)
      setStatusDot(DOT.active)
      setStatus('Recording…')
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } catch {
      showToast('Microphone access denied', 'error')
    }
  }

  async function stopRecording() {
    clearInterval(timerRef.current)
    setRecording(false)
    setStatusDot(DOT.active)
    setStatus('Processing recording…')
    setLoading(true)

    mrRef.current?.stream?.getTracks().forEach(t => t.stop())

    await new Promise(resolve => {
      mrRef.current.onstop = resolve
      mrRef.current.stop()
    })

    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })

    try {
      // Send to Render backend for STT → MOM
      const form = new FormData()
      form.append('file', blob, 'recording.webm')

      // Step 1: transcribe
      setStatus('Transcribing audio…')
      const sttRes  = await fetch(`${API_URL}/voice/transcribe`, { method: 'POST', body: form })
      const sttData = await sttRes.json()
      const transcript = sttData.transcript || ''

      if (!transcript) throw new Error('No speech detected')

      // Step 2: generate MOM via Apps Script (Gemini)
      setStatus('Generating minutes…')
      const momRes  = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action:        'generate-mom',
          transcript:    transcript,
          meeting_title: title || 'Meeting',
        }),
      })
      const momData = await momRes.json()
      if (momData.status !== 'success') throw new Error(momData.message)

      setResult({ ...momData, transcript })
      setStatusDot(DOT.done)
      setStatus('Minutes ready')
    } catch (e) {
      setStatusDot(DOT.warn)
      setStatus('Processing failed — try again')
      showToast('Failed: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setMode(null); setResult(null); setTitle('')
    setStatus(''); setStatusDot(DOT.idle)
    setNoteArmed(false); setNotePreview(null)
    setRecording(false); setElapsed(0)
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (videoRef.current) { videoRef.current.style.display = 'none'; videoRef.current.srcObject = null }
    clearInterval(timerRef.current)
  }

  function fmt(s) {
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
  }

  // ── RESULT VIEW ─────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="wrap">
        <div className="lcs-card is-done" style={{ marginTop: 20 }}>
          <div className="card-head">
            <div className="card-icon" style={{ background: '#E6F7EF' }}>
              <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                <path d="M9 11l3 3L22 4" stroke="#2FA36B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="#2FA36B" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div className="card-title">{title || 'Meeting'}</div>
              <div className="card-sub">Minutes ready</div>
            </div>
          </div>

          {/* Summary */}
          {result.summary && (
            <div style={{ background: '#F4FBF7', border: '1px solid #C8EDD9', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#2FA36B', letterSpacing: '.4px', textTransform: 'uppercase', marginBottom: 8 }}>
                Summary
              </div>
              <p style={{ fontSize: 13.5, color: '#1B2A4A', lineHeight: 1.6, margin: 0 }}>{result.summary}</p>
            </div>
          )}

          {/* Action items */}
          {result.action_items?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#3E7BFA', letterSpacing: '.4px', textTransform: 'uppercase', marginBottom: 10 }}>
                Action Items
              </div>
              {result.action_items.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#EAF0FB', border: '1.5px solid #3E7BFA', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#3E7BFA', flexShrink: 0, marginTop: 1 }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, color: '#1B2A4A', lineHeight: 1.5 }}>{item.task}</div>
                    {(item.owner || item.due) && (
                      <div style={{ fontSize: 11.5, color: '#5B6472', marginTop: 2 }}>
                        {item.owner && <span>👤 {item.owner}</span>}
                        {item.owner && item.due && <span style={{ margin: '0 6px' }}>·</span>}
                        {item.due && <span>📅 {item.due}</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Full MOM */}
          {result.mom && (
            <details style={{ marginBottom: 14 }}>
              <summary style={{ fontSize: 12.5, fontWeight: 600, color: '#5B6472', cursor: 'pointer', marginBottom: 8 }}>
                Full Minutes of Meeting
              </summary>
              <div style={{ fontSize: 13, color: '#1B2A4A', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: '#F5F7FA', borderRadius: 10, padding: 12, marginTop: 8 }}>
                {result.mom}
              </div>
            </details>
          )}

          {/* Email MOM */}
          {result.mom && (
            <a
              href={`mailto:?subject=MOM: ${encodeURIComponent(title || 'Meeting')}&body=${encodeURIComponent(result.mom)}`}
              className="btn btn-submit"
              style={{ display: 'flex', textDecoration: 'none', marginBottom: 8 }}
            >
              📧 Email MOM to myself
            </a>
          )}

          <button className="btn btn-scan" onClick={reset}>
            New Meeting
          </button>
        </div>
      </div>
    )
  }

  // ── MAIN UI ─────────────────────────────────────────────────────────────────
  return (
    <div className="wrap">

      {/* Title input */}
      <div className="lcs-card is-active" style={{ marginTop: 20 }}>
        <div className="card-head">
          <div className="card-icon">
            <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
              <rect x="3" y="4" width="18" height="18" rx="2" stroke="#3E7BFA" strokeWidth="1.5"/>
              <path d="M16 2v4M8 2v4M3 10h18" stroke="#3E7BFA" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div className="card-title">New Meeting</div>
            <div className="card-sub">Enter title then choose an option</div>
          </div>
        </div>

        <input
          style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #DCE6F7', fontSize: 15, color: '#1B2A4A', fontFamily: 'inherit' }}
          placeholder="Meeting title (e.g. Client call with Rahul)"
          value={title}
          onChange={e => setTitle(e.target.value)}
          disabled={loading || recording}
        />
      </div>

      {/* ── OPTION 1: Scan handwritten notes ── */}
      <div className={`lcs-card ${mode === 'notes' ? 'is-active' : ''}`} style={{ marginTop: 12 }}>
        <div className="card-head">
          <div className="card-icon" style={{ background: '#FFF6E5' }}>
            <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
              <path d="M12 20h9" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div className="card-title">Scan Handwritten Notes</div>
            <div className="card-sub">Take a photo of your notes → AI makes MOM</div>
          </div>
        </div>

        {mode === 'notes' && (
          <>
            <video ref={videoRef} autoPlay playsInline muted style={{
              display: 'none', width: '100%', borderRadius: 12,
              marginBottom: 12, background: '#000', aspectRatio: '4/3', objectFit: 'cover'
            }} />
            {notePreview && (
              <img src={notePreview} alt="Notes" style={{
                width: '100%', borderRadius: 12, marginBottom: 12,
                aspectRatio: '4/3', objectFit: 'cover'
              }} />
            )}
          </>
        )}

        {mode !== 'notes' ? (
          <button className="btn" style={{ background: '#F59E0B' }}
            onClick={() => { if (!title.trim()) return showToast('Enter a meeting title first', 'error'); setMode('notes') }}>
            📷 Scan Notes
          </button>
        ) : (
          <>
            <button
              className={`btn ${noteArmed ? 'btn-done' : ''}`}
              style={{ background: noteArmed ? '#2FA36B' : '#F59E0B' }}
              onClick={handleNotesCamera}
              disabled={loading}
            >
              {noteArmed ? '📸 Snap Photo' : notePreview ? '🔄 Retake' : '📷 Open Camera'}
            </button>

            {notePreview && !loading && !result && (
              <button className="btn btn-submit" style={{ marginTop: 8 }}
                onClick={handleNotesCamera}>
                {loading ? 'Processing…' : 'Process Notes →'}
              </button>
            )}
          </>
        )}

        {mode === 'notes' && (
          <div className="status-row">
            <span className={`dot ${statusDot}`} />
            <span>{status || 'Ready'}</span>
          </div>
        )}
      </div>

      {/* ── OPTION 2: Record meeting ── */}
      <div className={`lcs-card ${mode === 'record' ? 'is-active' : ''}`} style={{ marginTop: 12 }}>
        <div className="card-head">
          <div className="card-icon" style={{ background: '#FAEAEA' }}>
            <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="#D65A56" strokeWidth="1.5"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="#D65A56" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div className="card-title">Record Meeting</div>
            <div className="card-sub">Live recording → AI transcribes + makes MOM</div>
          </div>
        </div>

        {mode !== 'record' ? (
          <button className="btn" style={{ background: '#1B2A4A' }}
            onClick={() => { if (!title.trim()) return showToast('Enter a meeting title first', 'error'); setMode('record') }}>
            🎙 Start Recording
          </button>
        ) : (
          <>
            {!recording && !loading && (
              <button className="btn" style={{ background: '#D65A56' }} onClick={startRecording}>
                ● Start Recording
              </button>
            )}

            {recording && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#D65A56', animation: 'pulse 1s infinite' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 20, color: '#D65A56', fontWeight: 700 }}>{fmt(elapsed)}</span>
                  <span style={{ fontSize: 13, color: '#5B6472' }}>Recording…</span>
                </div>
                <button className="btn btn-stop" style={{ background: '#1B2A4A' }} onClick={stopRecording}>
                  ■ Stop & Process
                </button>
              </div>
            )}

            {loading && !recording && (
              <div className="status-row">
                <span className="dot active" />
                <span>{status}</span>
              </div>
            )}
          </>
        )}

        {mode === 'record' && !recording && !loading && (
          <div className="status-row">
            <span className={`dot ${statusDot}`} />
            <span>{status || 'Ready to record'}</span>
          </div>
        )}
      </div>

    </div>
  )
}

function showToast(msg, type = 'info') {
  let el = document.getElementById('tiby-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'tiby-toast'
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(10px);background:#1B2A4A;color:#fff;padding:12px 22px;border-radius:12px;font-size:13.5px;font-weight:500;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:9999;max-width:88vw;text-align:center;box-shadow:0 4px 20px rgba(27,42,74,.25)'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.style.background = type === 'error' ? '#D65A56' : type === 'success' ? '#2FA36B' : '#1B2A4A'
  el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'
  clearTimeout(el._t)
  el._t = setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(10px)' }, 3200)
}
