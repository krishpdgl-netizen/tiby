import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { transcribeVoice } from '../services/api'
import { useSpeech } from '../hooks/useSpeech'

const ROUTES = [
  { patterns: [/scan|card|visit|business/i], route: '/scan',      label: 'Opening card scanner…' },
  { patterns: [/meet|record|mom|minut|audio/i], route: '/meetings',  label: 'Opening meetings…' },
  { patterns: [/note|handwrit|whiteboard/i], route: '/meetings',  label: 'Opening notes scanner…' },
  { patterns: [/contact|people|saved/i], route: '/contacts',     label: 'Opening contacts…' },
  { patterns: [/analytic|task|dashboard|progress/i], route: '/analytics', label: 'Opening dashboard…' },
  { patterns: [/setting|gmail|connect|account/i], route: '/settings',  label: 'Opening settings…' },
]

// Detect task completion phrases
const DONE_PATTERNS = [
  /i (have |'ve |)?(done|completed|finished|sent|called|followed up|met|spoke|talked|emailed)/i,
  /done with/i, /completed the/i, /finished the/i, /sent the/i,
]

const QUICK = [
  { icon: 'ti-id',         label: 'Scan a card',       route: '/scan',      bg: '#fef3c7', color: '#92400e' },
  { icon: 'ti-microphone', label: 'Record meeting',     route: '/meetings',  bg: '#fee2e2', color: '#991b1b' },
  { icon: 'ti-pencil',     label: 'Scan notes',         route: '/meetings',  bg: '#fef3c7', color: '#92400e' },
  { icon: 'ti-chart-bar',  label: 'My dashboard',       route: '/analytics', bg: '#ede9fe', color: '#5b21b6' },
]

const ACTIONS = [
  { icon: 'ti-id',         label: 'Scan visiting card',      sub: 'Extract contact + draft email',     route: '/scan',      bg: '#fef3c7', color: '#92400e' },
  { icon: 'ti-microphone', label: 'Record meeting',           sub: 'Transcribe + generate MOM',          route: '/meetings',  bg: '#fee2e2', color: '#991b1b' },
  { icon: 'ti-chart-bar',  label: 'Dashboard & tasks',        sub: 'Track action items + priorities',    route: '/analytics', bg: '#ede9fe', color: '#5b21b6' },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function HomePage({ user }) {
  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there'
  const [messages, setMessages] = useState([
    { id: 1, role: 'tiby', type: 'actions', text: `${greeting()}, ${firstName}! What would you like to do?` }
  ])
  const [input, setInput]       = useState('')
  const [recording, setRecording] = useState(false)
  const [thinking, setThinking]   = useState(false)
  const navigate  = useNavigate()
  const { speak } = useSpeech()
  const mrRef     = useRef()
  const chunksRef = useRef([])
  const bottomRef = useRef()

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  function addMsg(role, text, type = 'text') {
    setMessages(m => [...m, { id: Date.now() + Math.random(), role, text, type }])
  }

  async function handleCommand(text) {
    if (!text.trim()) return
    addMsg('user', text)
    setInput('')
    setThinking(true)
    await new Promise(r => setTimeout(r, 350))

    const clean = text.toLowerCase().replace(/hey tiby[,.]?\s*/gi, '').trim()

    // Check if user is marking a task done
    const isDoneIntent = DONE_PATTERNS.some(p => p.test(clean))
    if (isDoneIntent) {
      try {
        const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''
        const res  = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'complete-task', text: clean }),
        })
        const data = await res.json()
        if (data.status === 'success') {
          const reply = `✅ Got it — marked "${data.task}" as done!`
          addMsg('tiby', reply)
          speak(reply)
          setThinking(false)
          return
        } else if (data.status === 'no_match') {
          const reply = "I couldn't find a matching task. You can mark it done manually in the Analytics page."
          addMsg('tiby', reply)
          setThinking(false)
          return
        }
      } catch {}
    }

    const match = ROUTES.find(r => r.patterns.some(p => p.test(clean)))
    if (match) {
      addMsg('tiby', match.label)
      speak(match.label)
      setTimeout(() => navigate(match.route), 800)
    } else {
      const reply = "I can scan cards, record meetings, scan notes, manage contacts, or show your dashboard. What would you like to do?"
      addMsg('tiby', reply)
      speak(reply)
    }
    setThinking(false)
  }

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
        setThinking(true)
        try {
          const { data } = await transcribeVoice(blob)
          if (data.transcript) await handleCommand(data.transcript)
          else addMsg('tiby', "I didn't catch that. Try again or type your request.")
        } catch {
          addMsg('tiby', "Couldn't transcribe. Try typing instead.")
        } finally { setThinking(false) }
      }
      mr.start(); setRecording(true)
    } catch {
      addMsg('tiby', "Microphone access denied. Please type your request.")
    }
  }

  function stopRecording() { mrRef.current?.stop(); setRecording(false) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f9f9f8' }}>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.map(msg => (
          <div key={msg.id}>
            <div className={`t-bubble-row ${msg.role === 'user' ? 'user' : ''}`}>
              {msg.role === 'tiby' && (
                <div className="t-bubble-av">T</div>
              )}
              {msg.role === 'user' && (
                <div className="t-bubble-av user">
                  {(user?.user_metadata?.full_name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
                </div>
              )}
              <div className="t-bubble">{msg.text}</div>
            </div>

            {/* Action cards — only on first message */}
            {msg.type === 'actions' && (
              <div style={{ marginLeft: 37, marginTop: 8 }}>
                <div style={{ border: '1px solid #f0f0ef', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                  {ACTIONS.map((a, i) => (
                    <button key={i} className="t-action-row" onClick={() => navigate(a.route)}>
                      <div className="t-action-row-icon" style={{ background: a.bg, color: a.color }}>
                        <i className={`ti ${a.icon}`} aria-hidden="true" />
                      </div>
                      <div>
                        <div className="t-action-row-name">{a.label}</div>
                        <div className="t-action-row-sub">{a.sub}</div>
                      </div>
                      <i className="ti ti-chevron-right" aria-hidden="true" style={{ marginLeft: 'auto', fontSize: 14, color: '#9ca3af' }} />
                    </button>
                  ))}
                </div>

                {/* Quick chips */}
                <div className="t-chips" style={{ marginTop: 10 }}>
                  {QUICK.map(q => (
                    <button key={q.label} className="t-chip" onClick={() => navigate(q.route)}>
                      <i className={`ti ${q.icon}`} aria-hidden="true" />
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {thinking && (
          <div className="t-bubble-row">
            <div className="t-bubble-av">T</div>
            <div style={{ background: '#fff', border: '1px solid #f0f0ef', borderRadius: '4px 14px 14px 14px' }}>
              <div className="t-thinking"><span/><span/><span/></div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="t-input-bar">
        <div className="t-input-wrap">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCommand(input) } }}
            placeholder={recording ? 'Listening…' : 'Ask Tiby anything…'}
            disabled={recording || thinking}
          />
          <button
            className={`t-ib t-ib-mic ${recording ? 'active' : ''}`}
            onMouseDown={startRecording} onMouseUp={stopRecording}
            onTouchStart={startRecording} onTouchEnd={stopRecording}
            aria-label="Hold to speak"
          >
            <i className={`ti ${recording ? 'ti-microphone-off' : 'ti-microphone'}`} aria-hidden="true" />
          </button>
          <button
            className="t-ib t-ib-send"
            onClick={() => handleCommand(input)}
            disabled={!input.trim() || thinking}
            aria-label="Send"
          >
            <i className="ti ti-arrow-up" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
