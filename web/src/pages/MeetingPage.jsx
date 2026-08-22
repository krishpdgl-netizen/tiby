import { useState, useRef, useEffect } from 'react'
import { startMeeting, uploadMeetingAudio, getMeeting, processMeetingNotes, listMeetings, getProfile } from '../services/api'

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  return types.find(t => MediaRecorder.isTypeSupported(t)) || ''
}

function fmt(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function timeAgo(iso) {
  const d = new Date(iso), now = new Date()
  const diff = Math.floor((now - d) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function buildWaUrl(phone, text) {
  if (phone) {
    const num = phone.replace(/\D/g, '')
    return `https://wa.me/${num}?text=${encodeURIComponent(text)}`
  }
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

function MeetingHistory() {
  const [meetings, setMeetings] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [myPhone, setMyPhone] = useState('')

  useEffect(() => {
    Promise.all([
      listMeetings().then(r => setMeetings(r.data || [])),
      getProfile().then(r => setMyPhone(r.data?.mobile || '')).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  if (selected) return <MeetingDetail meeting={selected} myPhone={myPhone} onBack={() => setSelected(null)} />

  const done = meetings.filter(m => m.status === 'done')

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>
      <div style={{ marginBottom: 12, padding: '0 2px' }}>
        <div className="t-ct">Past meetings</div>
        <div className="t-cs">{done.length} completed</div>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 13 }}>Loading…</div>
      ) : done.length === 0 ? (
        <div className="t-card" style={{ textAlign: 'center', padding: '24px 16px' }}>
          <i className="ti ti-microphone" style={{ fontSize: 36, color: '#d1d5db', display: 'block', marginBottom: 10 }} aria-hidden="true" />
          <div className="t-ct" style={{ marginBottom: 6 }}>No meetings yet</div>
          <div className="t-cs">Record your first meeting to see minutes here</div>
        </div>
      ) : (
        <div className="t-card" style={{ padding: '4px 14px' }}>
          {done.map(m => (
            <div key={m.id} className="t-row" onClick={() => setSelected(m)} style={{ cursor: 'pointer' }}>
              <div className="t-row-av" style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 10 }}>
                <i className="ti ti-microphone" aria-hidden="true" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-row-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.title || 'Untitled meeting'}
                </div>
                <div className="t-row-sub">
                  {timeAgo(m.created_at)}
                  {m.action_items?.length > 0 && ` · ${m.action_items.length} action item${m.action_items.length !== 1 ? 's' : ''}`}
                </div>
              </div>
              <i className="ti ti-chevron-right" style={{ fontSize: 14, color: '#9ca3af', flexShrink: 0 }} aria-hidden="true" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MeetingDetail({ meeting, myPhone, onBack }) {
  const momText = `*MOM: ${meeting.title || 'Meeting'}*\n\n${meeting.summary || ''}\n\n${meeting.mom || ''}`.slice(0, 4096)
  const waUrl   = buildWaUrl(myPhone, momText)
  const mailHref = `mailto:?subject=${encodeURIComponent('MOM: ' + (meeting.title || 'Meeting'))}&body=${encodeURIComponent(meeting.mom || meeting.summary || '')}`

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>
      <button onClick={onBack} className="t-btn t-btn-ghost" style={{ marginBottom: 8 }}>
        <i className="ti ti-arrow-left" aria-hidden="true" /> Back
      </button>
      <div className="t-card success">
        <div className="t-card-head">
          <div className="t-icon ti-green"><i className="ti ti-check" aria-hidden="true" /></div>
          <div>
            <div className="t-ct">{meeting.title || 'Meeting'}</div>
            <div className="t-cs">{timeAgo(meeting.created_at)}</div>
          </div>
        </div>
        {meeting.summary && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#065f46', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>Summary</div>
            <p style={{ fontSize: 13.5, color: '#1a1a1a', lineHeight: 1.6, margin: 0 }}>{meeting.summary}</p>
          </div>
        )}
        {meeting.action_items?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 10 }}>Action items</div>
            {meeting.action_items.map((item, i) => (
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
        {meeting.mom && (
          <details style={{ marginBottom: 12 }}>
            <summary style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', cursor: 'pointer', userSelect: 'none', listStyle: 'none' }}>
              <i className="ti ti-file-text" style={{ fontSize: 16 }} aria-hidden="true" /> Full minutes
            </summary>
            <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: '#f9f9f8', borderRadius: 9, padding: 12, marginTop: 8 }}>
              {meeting.mom}
            </div>
          </details>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={waUrl} target="_blank" rel="noopener noreferrer"
            className="t-btn t-btn-green" style={{ flex: 1, textDecoration: 'none', display: 'flex', justifyContent: 'center' }}>
            📱 {myPhone ? 'Send to me' : 'WhatsApp'}
          </a>
          <a href={mailHref} className="t-btn t-btn-primary" style={{ flex: 1, textDecoration: 'none', display: 'flex', justifyContent: 'center' }}>
            <i className="ti ti-mail" aria-hidden="true" /> Email
          </a>
        </div>
        {myPhone && (
          <div style={{ fontSize: 11.5, color: '#9ca3af', textAlign: 'center', marginTop: 6 }}>
            Sending to your number: {myPhone}
          </div>
        )}
      </div>
    </div>
  )
}

export default function MeetingPage() {
  const [tab, setTab]           = useState('new')
  const [title, setTitle]       = useState('')
  const [mode, setMode]         = useState(null)
  const [result, setResult]     = useState(null)
  const [loading, setLoading]   = useState(false)
  const [status, setStatus]     = useState('')
  const [dot, setDot]           = useState('idle')
  const [noteBlob, setNoteBlob] = useState(null)
  const [notePreview, setNotePreview] = useState(null)
  const [cameraOpen, setCameraOpen]   = useState(false)
  const [recording, setRecording]     = useState(false)
  const [elapsed, setElapsed]   = useState(0)
  const [pollTimer, setPollTimer] = useState(null)
  const [myPhone, setMyPhone]   = useState('')

  const videoRef  = useRef()
  const streamRef = useRef()
  const mrRef     = useRef()
  const chunksRef = useRef([])
  const timerRef  = useRef()

  useEffect(() => {
    getProfile().then(r => setMyPhone(r.data?.mobile || '')).catch(() => {})
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
      out.width = Math.round(canvas.width * s); out.height = Math.round(canvas.height * s)
      out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height)
      out.toBlob(resolve, 'image/jpeg', 0.82)
    })
  }

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream; videoRef.current.srcObject = stream
      videoRef.current.style.display = 'block'; setCameraOpen(true)
    } catch { toast('Camera access denied', 'error') }
  }

  async function snapPhoto() {
    const cv = document.createElement('canvas')
    cv.width = videoRef.current.videoWidth; cv.height = videoRef.current.videoHeight
    cv.getContext('2d').drawImage(videoRef.current, 0, 0)
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null
    videoRef.current.style.display = 'none'; setCameraOpen(false)
    const blob = await resize(cv); setNoteBlob(blob); setNotePreview(URL.createObjectURL(blob))
  }

  async function processNotes() {
    if (!noteBlob) return
    setLoading(true); setDot('active'); setStatus('Reading handwritten notes…')
    try {
      const imageFile = new File([noteBlob], 'notes.jpg', { type: 'image/jpeg' })
      const { data } = await processMeetingNotes(imageFile, title || 'Meeting')
      setResult(data); setDot('done'); setStatus('Minutes ready')
    } catch (e) {
      setDot('warn'); setStatus('Could not process — try again')
      toast(e?.response?.data?.detail || 'Error processing notes', 'error')
    } finally { setLoading(false) }
  }

  async function startRecording() {
    if (!title.trim()) return toast('Enter a meeting title first', 'error')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream; chunksRef.current = []
      const mimeType = getSupportedMimeType()
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      mrRef.current = mr
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(1000); setRecording(true); setElapsed(0); setDot('active'); setStatus('Recording…')
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } catch (e) { toast('Could not start recording: ' + e.message, 'error') }
  }

  async function stopRecording() {
    clearInterval(timerRef.current); setRecording(false)
    setLoading(true); setDot('active'); setStatus('Saving…')
    const mimeType = mrRef.current?.mimeType || 'audio/webm'
    await new Promise(resolve => {
      mrRef.current.onstop = resolve
      streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null
      try { mrRef.current.stop() } catch {}
    })
    const blob = new Blob(chunksRef.current, { type: mimeType })
    try {
      setStatus('Creating meeting…')
      const { data: md } = await startMeeting(title)
      setStatus('Uploading audio…')
      await uploadMeetingAudio(md.meeting_id, blob)
      setStatus('Processing — this may take a minute…')
      pollMeeting(md.meeting_id)
    } catch (e) {
      setDot('warn'); setStatus('Failed to save meeting')
      toast(e?.response?.data?.detail || 'Failed', 'error'); setLoading(false)
    }
  }

  async function pollMeeting(id, attempts = 0) {
    if (attempts > 30) { setDot('warn'); setStatus('Taking longer — check back soon'); setLoading(false); return }
    try {
      const { data } = await getMeeting(id)
      if (data.status === 'done') { setResult(data); setDot('done'); setStatus('Minutes ready'); setLoading(false) }
      else if (data.status === 'failed') { setDot('warn'); setStatus('Failed: ' + (data.processing_error || 'unknown')); setLoading(false) }
      else { const t = setTimeout(() => pollMeeting(id, attempts + 1), 4000); setPollTimer(t) }
    } catch { const t = setTimeout(() => pollMeeting(id, attempts + 1), 5000); setPollTimer(t) }
  }

  function reset() {
    setMode(null); setResult(null); setTitle(''); setStatus(''); setDot('idle')
    setNoteBlob(null); setNotePreview(null); setCameraOpen(false); setRecording(false); setElapsed(0)
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null
    if (videoRef.current) { videoRef.current.style.display = 'none'; videoRef.current.srcObject = null }
    clearInterval(timerRef.current); try { mrRef.current?.stop() } catch {}
  }

  const momText  = result ? `*MOM: ${result.title || 'Meeting'}*\n\n${result.summary || ''}\n\n${result.mom || ''}`.slice(0, 4096) : ''
  const waUrl    = result ? buildWaUrl(myPhone, momText) : '#'
  const mailHref = result ? `mailto:?subject=${encodeURIComponent('MOM: ' + (result.title || 'Meeting'))}&body=${encodeURIComponent(result.mom || result.summary || '')}` : '#'

  if (result) return (
    <div className="t-content" style={{ paddingTop: 16 }}>
      <div className="t-card success">
        <div className="t-card-head">
          <div className="t-icon ti-green"><i className="ti ti-check" aria-hidden="true" /></div>
          <div><div className="t-ct">{result.title || 'Meeting'}</div><div className="t-cs">Minutes ready</div></div>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={waUrl} target="_blank" rel="noopener noreferrer"
            className="t-btn t-btn-green" style={{ flex: 1, textDecoration: 'none', display: 'flex', justifyContent: 'center' }}>
            📱 {myPhone ? 'Send to me' : 'WhatsApp'}
          </a>
          <a href={mailHref} className="t-btn t-btn-primary" style={{ flex: 1, textDecoration: 'none', display: 'flex', justifyContent: 'center' }}>
            <i className="ti ti-mail" aria-hidden="true" /> Email
          </a>
        </div>
        {myPhone && <div style={{ fontSize: 11.5, color: '#9ca3af', textAlign: 'center', marginTop: 6 }}>To: {myPhone}</div>}
        <button className="t-btn t-btn-ghost" onClick={reset} style={{ marginTop: 8 }}>
          <i className="ti ti-plus" aria-hidden="true" /> New meeting
        </button>
      </div>
    </div>
  )

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[['new', 'New meeting'], ['history', 'History']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '7px 16px', borderRadius: 20, border: '1px solid #e5e5e4',
            fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
            background: tab === key ? '#1a1a1a' : '#fff',
            color: tab === key ? '#fff' : '#6b7280',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'history' ? <MeetingHistory /> : (
        <>
          <div className="t-card">
            <div className="t-card-head">
              <div className="t-icon ti-gray"><i className="ti ti-calendar" aria-hidden="true" /></div>
              <div><div className="t-ct">New meeting</div><div className="t-cs">Enter title then choose an option</div></div>
            </div>
            <input className="t-input" placeholder="Meeting title — e.g. Client call with Rahul"
              value={title} onChange={e => setTitle(e.target.value)} disabled={loading || recording} />
          </div>

          <div className={`t-card ${mode === 'notes' ? 'accent' : ''}`}>
            <div className="t-card-head">
              <div className="t-icon ti-amber"><i className="ti ti-pencil" aria-hidden="true" /></div>
              <div><div className="t-ct">Scan handwritten notes</div><div className="t-cs">Photo → AI minutes + tasks</div></div>
            </div>
            {mode !== 'notes' ? (
              <button className="t-btn t-btn-amber" onClick={() => {
                if (!title.trim()) return toast('Enter a meeting title first', 'error')
                setMode('notes'); setTimeout(() => openCamera(), 50)
              }}><i className="ti ti-pencil" aria-hidden="true" /> Scan notes</button>
            ) : (
              <>
                <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none', width: '100%', borderRadius: 11, marginBottom: 10, background: '#000', aspectRatio: '4/3', objectFit: 'cover' }} />
                {notePreview && <img src={notePreview} alt="Notes" style={{ width: '100%', borderRadius: 11, marginBottom: 10, aspectRatio: '4/3', objectFit: 'cover' }} />}
                {!cameraOpen && !noteBlob && !loading && <button className="t-btn t-btn-amber" onClick={openCamera}><i className="ti ti-camera" aria-hidden="true" /> Open camera</button>}
                {cameraOpen && <button className="t-btn t-btn-green" onClick={snapPhoto}><i className="ti ti-camera-selfie" aria-hidden="true" /> Snap photo</button>}
                {noteBlob && !loading && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="t-btn t-btn-ghost" style={{ flex: 1 }} onClick={() => { setNoteBlob(null); setNotePreview(null); openCamera() }}><i className="ti ti-refresh" aria-hidden="true" /> Retake</button>
                    <button className="t-btn t-btn-primary" style={{ flex: 2, marginTop: 0 }} onClick={processNotes}><i className="ti ti-wand" aria-hidden="true" /> Process notes</button>
                  </div>
                )}
                {loading && <div className="t-dot-row"><span className="t-dot t-dot-active" /><span>{status}</span></div>}
              </>
            )}
          </div>

          <div className={`t-card ${mode === 'record' ? 'danger' : ''}`}>
            <div className="t-card-head">
              <div className="t-icon ti-red"><i className="ti ti-microphone" aria-hidden="true" /></div>
              <div><div className="t-ct">Record meeting</div><div className="t-cs">Live audio → AI minutes + tasks</div></div>
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
                    <button className="t-btn t-btn-red" onClick={stopRecording}><i className="ti ti-square" aria-hidden="true" /> Stop and process</button>
                  </div>
                )}
                {!recording && !loading && <button className="t-btn t-btn-red" onClick={startRecording}><i className="ti ti-circle" aria-hidden="true" /> Start recording</button>}
                {loading && !recording && <div className="t-dot-row"><span className="t-dot t-dot-active" /><span>{status}</span></div>}
                {dot === 'warn' && !loading && !recording && <div className="t-dot-row"><span className="t-dot t-dot-warn" /><span>{status}</span></div>}
              </>
            )}
          </div>
        </>
      )}
      <style>{`@keyframes tdot{50%{opacity:.3}}`}</style>
    </div>
  )
}

function toast(msg, type = 'info') {
  let el = document.getElementById('t-toast')
  if (!el) { el = document.createElement('div'); el.id = 't-toast'; document.body.appendChild(el) }
  el.textContent = msg; el.className = type === 'error' ? 'error' : type === 'success' ? 'success' : ''
  el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 3000)
}
