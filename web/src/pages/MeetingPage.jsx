import { useState, useRef, useEffect } from 'react'
import { startMeeting, uploadMeetingAudio, getMeeting, processMeetingNotes } from '../services/api'

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  return types.find(t => MediaRecorder.isTypeSupported(t)) || ''
}

export default function MeetingPage() {
  const [title, setTitle]             = useState('')
  const [mode, setMode]               = useState(null)
  const [result, setResult]           = useState(null)
  const [loading, setLoading]         = useState(false)
  const [status, setStatus]           = useState('')
  const [dot, setDot]                 = useState('idle')
  const [noteBlob, setNoteBlob]       = useState(null)
  const [notePreview, setNotePreview] = useState(null)
  const [cameraOpen, setCameraOpen]   = useState(false)
  const [recording, setRecording]     = useState(false)
  const [elapsed, setElapsed]         = useState(0)
  const [meetingId, setMeetingId]     = useState(null)
  const [pollTimer, setPollTimer]     = useState(null)

  const videoRef  = useRef()
  const streamRef = useRef()
  const mrRef     = useRef()
  const chunksRef = useRef([])
  const timerRef  = useRef()

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
      try { mrRef.current?.stop() } catch {}
      clearInterval(timerRef.current)
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [pollTimer])

  function resize(canvas, max = 1280) {
    return new Promise(resolve => {
      const s = Math.min(max / canvas.width, max / canvas.height, 1)
      const out = document.createElement('canvas')
      out.width = Math.round(canvas.width * s)
      out.height = Math.round(canvas.height * s)
      out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height)
      out.toBlob(resolve, 'image/jpeg', 0.82)
    })
  }

  function fmt(s) {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      videoRef.current.style.display = 'block'
      setCameraOpen(true)
    } catch { toast('Camera access denied', 'error') }
  }

  async function snapPhoto() {
    const cv = document.createElement('canvas')
    cv.width = videoRef.current.videoWidth
    cv.height = videoRef.current.videoHeight
    cv.getContext('2d').drawImage(videoRef.current, 0, 0)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    videoRef.current.style.display = 'none'
    setCameraOpen(false)
    const blob = await resize(cv)
    setNoteBlob(blob)
    setNotePreview(URL.createObjectURL(blob))
  }

  async function processNotes() {
    if (!noteBlob) return
    setLoading(true); setDot('active'); setStatus('Reading handwritten notes…')
    try {
      const imageFile = new File([noteBlob], 'notes.jpg', { type: 'image/jpeg' })
      const { data } = await processMeetingNotes(imageFile, title || 'Meeting')
      setResult(data); setDot('done'); setStatus('Minutes ready')
    } catch (e) {
      setDot('warn')
      setStatus('Could not process — try again')
      toast(e?.response?.data?.detail || 'Error processing notes', 'error')
    } finally { setLoading(false) }
  }

  async function startRecording() {
    if (!title.trim()) return toast('Enter a meeting title first', 'error')
    try {
      const { data } = await startMeeting(title)
      setMeetingId(data.meeting_id)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const mimeType = getSupportedMimeType()
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      mrRef.current = mr
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(1000)
      setRecording(true); setElapsed(0)
      setDot('active'); setStatus('Recording…')
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } catch (e) { toast('Could not start recording: ' + e.message, 'error') }
  }

  async function stopRecording() {
    clearInterval(timerRef.current); setRecording(false)
    setLoading(true); setDot('active'); setStatus('Uploading…')
    const mimeType = mrRef.current?.mimeType || 'audio/webm'

    await new Promise(resolve => {
      mrRef.current.onstop = resolve
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      try { mrRef.current.stop() } catch {}
    })

    const blob = new Blob(chunksRef.current, { type: mimeType })
    try {
      await uploadMeetingAudio(meetingId, blob)
      setStatus('Processing — this may take a minute…')
      pollMeeting(meetingId)
    } catch (e) {
      setDot('warn'); setStatus('Upload failed')
      toast(e?.response?.data?.detail || 'Upload failed', 'error')
      setLoading(false)
    }
  }

  async function pollMeeting(id, attempts = 0) {
    if (attempts > 30) {
      setDot('warn')
      setStatus('Processing taking longer than expected — check back soon')
      setLoading(false)
      return
    }
    try {
      const { data } = await getMeeting(id)
      if (data.status === 'done') {
        setResult(data); setDot('done'); setStatus('Minutes ready'); setLoading(false)
      } else if (data.status === 'failed') {
        setDot('warn')
        setStatus('Processing failed: ' + (data.processing_error || 'unknown error'))
        setLoading(false)
      } else {
        const t = setTimeout(() => pollMeeting(id, attempts + 1), 4000)
        setPollTimer(t)
      }
    } catch {
      const t = setTimeout(() => pollMeeting(id, attempts + 1), 5000)
      setPollTimer(t)
    }
  }

  function reset() {
    setMode(null); setResult(null); setTitle(''); setMeetingId(null)
    setStatus(''); setDot('idle'); setNoteBlob(null); setNotePreview(null); setCameraOpen(false)
    setRecording(false); setElapsed(0)
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null
    if (videoRef.current) { videoRef.current.style.display = 'none'; videoRef.current.srcObject = null }
    clearInterval(timerRef.current)
    try { mrRef.current?.stop() } catch {}
  }

  if (result) return (
    <div className="t-content" style={{ paddingTop: 16 }}>
      <div className="t-card success">
        <div className="t-card-head">
          <div className="t-icon ti-green"><i className="ti ti-check" aria-hidden="true" /></div>
          <div>
            <div className="t-ct">{result.title || 'Meeting'}</div>
            <div className="t-cs">Minutes ready</div>
          </div>
        </div>
        {result.summary && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#065f46', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>Summary</div>
            <p style={{ fontSize: 13.5, color: '#1a1a1a', lineHeight: 1.6, margin: 0 }}>{result.summary}</p>
          </div>
        )}
        {result.action_items?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 10 }}>Action items</div>
            {result.action_items.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 9, marginBottom: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#dbeafe', border: '1.5px solid #93c5fd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#1e40af', flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                <div>
                  <div style={{ fontSize: 13.5, color: '#1a1a1a', lineHeight: 1.5 }}>{item.task}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, display: 'flex', gap: 12 }}>
                    {item.owner && item.owner !== 'TBD' && <span>👤 {item.owner}</span>}
                    {item.due && item.due !== 'TBD' && <span>📅 {item.due}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {result.mom && (
          <details style={{ marginBottom: 12 }}>
            <summary style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', cursor: 'pointer', userSelect: 'none', listStyle: 'none' }}>
              <i className="ti ti-file-text" style={{ fontSize: 16 }} aria-hidden="true" /> Full minutes
            </summary>
            <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: '#f9f9f8', borderRadius: 9, padding: 12, marginTop: 8 }}>
              {result.mom}
            </div>
          </details>
        )}
        <a href={`mailto:?subject=${encodeURIComponent('MOM: ' + (result.title || 'Meeting'))}&body=${encodeURIComponent(result.mom || result.summary || '')}`}
          className="t-btn t-btn-primary" style={{ textDecoration: 'none', display: 'flex' }}>
          <i className="ti ti-mail" aria-hidden="true" /> Email MOM to myself
        </a>
        <button className="t-btn t-btn-ghost" onClick={reset}>
          <i className="ti ti-plus" aria-hidden="true" /> New meeting
        </button>
      </div>
    </div>
  )

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>
      <div className="t-card">
        <div className="t-card-head">
          <div className="t-icon ti-gray"><i className="ti ti-calendar" aria-hidden="true" /></div>
          <div>
            <div className="t-ct">New meeting</div>
            <div className="t-cs">Enter title then choose an option</div>
          </div>
        </div>
        <input className="t-input" placeholder="Meeting title — e.g. Client call with Rahul"
          value={title} onChange={e => setTitle(e.target.value)} disabled={loading || recording} />
      </div>

      <div className={`t-card ${mode === 'notes' ? 'accent' : ''}`}>
        <div className="t-card-head">
          <div className="t-icon ti-amber"><i className="ti ti-pencil" aria-hidden="true" /></div>
          <div>
            <div className="t-ct">Scan handwritten notes</div>
            <div className="t-cs">Photo → AI minutes + tasks</div>
          </div>
        </div>
        {mode !== 'notes' ? (
          <button className="t-btn t-btn-amber" onClick={() => {
            if (!title.trim()) return toast('Enter a meeting title first', 'error')
            setMode('notes'); setTimeout(() => openCamera(), 50)
          }}>
            <i className="ti ti-pencil" aria-hidden="true" /> Scan notes
          </button>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted
              style={{ display: 'none', width: '100%', borderRadius: 11, marginBottom: 10, background: '#000', aspectRatio: '4/3', objectFit: 'cover' }} />
            {notePreview && <img src={notePreview} alt="Notes" style={{ width: '100%', borderRadius: 11, marginBottom: 10, aspectRatio: '4/3', objectFit: 'cover' }} />}
            {!cameraOpen && !noteBlob && !loading && (
              <button className="t-btn t-btn-amber" onClick={openCamera}><i className="ti ti-camera" aria-hidden="true" /> Open camera</button>
            )}
            {cameraOpen && (
              <button className="t-btn t-btn-green" onClick={snapPhoto}><i className="ti ti-camera-selfie" aria-hidden="true" /> Snap photo</button>
            )}
            {noteBlob && !loading && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="t-btn t-btn-ghost" style={{ flex: 1 }} onClick={() => { setNoteBlob(null); setNotePreview(null); openCamera() }}>
                  <i className="ti ti-refresh" aria-hidden="true" /> Retake
                </button>
                <button className="t-btn t-btn-primary" style={{ flex: 2, marginTop: 0 }} onClick={processNotes}>
                  <i className="ti ti-wand" aria-hidden="true" /> Process notes
                </button>
              </div>
            )}
            {loading && <div className="t-dot-row"><span className="t-dot t-dot-active" /><span>{status}</span></div>}
          </>
        )}
      </div>

      <div className={`t-card ${mode === 'record' ? 'danger' : ''}`}>
        <div className="t-card-head">
          <div className="t-icon ti-red"><i className="ti ti-microphone" aria-hidden="true" /></div>
          <div>
            <div className="t-ct">Record meeting</div>
            <div className="t-cs">Live audio → STT → AI minutes + tasks</div>
          </div>
        </div>
        {mode !== 'record' ? (
          <button className="t-btn t-btn-primary" onClick={() => { setMode('record'); setTimeout(() => startRecording(), 50) }}>
            <i className="ti ti-microphone" aria-hidden="true" /> Start recording
          </button>
        ) : (
          <>
            {recording && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 11, padding: '14px 16px', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#ef4444', animation: 'tdot 1s infinite' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 22, color: '#ef4444', fontWeight: 600 }}>{fmt(elapsed)}</span>
                  <span style={{ fontSize: 13, color: '#6b7280' }}>Recording…</span>
                </div>
                <button className="t-btn t-btn-red" onClick={stopRecording}>
                  <i className="ti ti-square" aria-hidden="true" /> Stop and process
                </button>
              </div>
            )}
            {!recording && !loading && (
              <button className="t-btn t-btn-red" onClick={startRecording}>
                <i className="ti ti-circle" aria-hidden="true" /> Start recording
              </button>
            )}
            {loading && !recording && <div className="t-dot-row"><span className="t-dot t-dot-active" /><span>{status}</span></div>}
            {dot === 'warn' && !loading && !recording && <div className="t-dot-row"><span className="t-dot t-dot-warn" /><span>{status}</span></div>}
          </>
        )}
      </div>
      <style>{`@keyframes tdot{50%{opacity:.3}}`}</style>
    </div>
  )
}

function toast(msg, type = 'info') {
  let el = document.getElementById('t-toast')
  if (!el) { el = document.createElement('div'); el.id = 't-toast'; document.body.appendChild(el) }
  el.textContent = msg
  el.className = type === 'error' ? 'error' : type === 'success' ? 'success' : ''
  el.classList.add('show')
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 3000)
}
