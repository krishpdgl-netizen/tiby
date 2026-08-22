import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpeech } from '../hooks/useSpeech'
import { agentChat, transcribeVoice } from '../services/api'

const STORAGE_KEY = 'tiby_chat_history'
const QUICK_ACTIONS = [
  { icon:'ti-id', label:'Scan visiting card', sub:'Extract + draft email', route:'/scan', bg:'#fef3c7',color:'#92400e' },
  { icon:'ti-microphone', label:'Record meeting', sub:'Transcribe + generate MOM', route:'/meetings', bg:'#fee2e2',color:'#991b1b' },
  { icon:'ti-chart-bar', label:'Dashboard & tasks', sub:'Track action items', route:'/analytics', bg:'#ede9fe',color:'#5b21b6' },
]
const CHIPS = [
  { icon:'ti-id',label:'Scan a card',route:'/scan' },
  { icon:'ti-microphone',label:'Record meeting',route:'/meetings' },
  { icon:'ti-chart-bar',label:'My tasks',route:'/analytics' },
  { icon:'ti-users',label:'Contacts',route:'/contacts' },
]
function greeting(){const h=new Date().getHours();return h<12?'Good morning':h<17?'Good afternoon':'Good evening'}

export default function HomePage({ user }) {
  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there'
  const [messages, setMessages] = useState(() => {
    try { const s = sessionStorage.getItem(STORAGE_KEY); if (s) return JSON.parse(s) } catch {}
    return [{ id: 1, role: 'tiby', type: 'actions', text: `${greeting()}, ${firstName}! What would you like to do today?` }]
  })
  const [input, setInput]       = useState('')
  const [recording, setRecording] = useState(false)
  const [thinking, setThinking]   = useState(false)
  const navigate  = useNavigate()
  const { speak } = useSpeech()
  const mrRef     = useRef()
  const chunksRef = useRef([])
  const bottomRef = useRef()
  const streamRef = useRef()
  const inputRef  = useRef()

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50))) } catch {}
  }, [messages])

  // Scroll to bottom smoothly
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  // Refocus input after reply
  useEffect(() => {
    if (!thinking && !recording) inputRef.current?.focus()
  }, [messages, thinking, recording])

  function addMsg(role, text, type = 'text') {
    setMessages(m => [...m, { id: Date.now() + Math.random(), role, text, type }])
  }

  function serverHistory() {
    return messages.filter(m => m.type !== 'actions').slice(-20)
      .map(m => ({ role: m.role === 'tiby' ? 'assistant' : 'user', content: m.text }))
  }

  async function handleCommand(text) {
    if (!text.trim() || thinking) return
    const history = serverHistory()
    addMsg('user', text)
    setInput('')
    setThinking(true)
    try {
      const { data } = await agentChat(text, history)
      addMsg('tiby', data.reply || 'Done.')
      for (const action of data.actions || []) {
        if (!action.ok) continue
        if (action.type === 'navigate' && action.route) {
          const msg = text.toLowerCase()
          const navWords = ['go to', 'open', 'take me', 'navigate', 'show me', 'switch to']
          if (navWords.some(w => msg.includes(w))) setTimeout(() => navigate(action.route), 700)
        }
        // Open deep links for call/whatsapp/email actions
        if (['call_contact', 'whatsapp_contact', 'email_contact'].includes(action.type) && action.url) {
          setTimeout(() => window.open(action.url, '_blank'), 300)
        }
      }
      speak((data.reply || 'Done.').slice(0, 200))
    } catch (e) {
      console.error(e)
      addMsg('tiby', e?.response?.status === 429
        ? 'Too many requests — try again in a moment.'
        : 'Something went wrong — check your connection.')
    } finally {
      setThinking(false)
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const mr = new MediaRecorder(stream)
      mrRef.current = mr
      mr.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setThinking(true)
        try {
          const { data } = await transcribeVoice(blob)
          if (data.transcript) await handleCommand(data.transcript)
          else addMsg('tiby', "I didn't catch that. Try typing instead!")
        } catch { addMsg('tiby', "Couldn't transcribe. Try typing instead!") }
        finally { setThinking(false) }
      }
      mr.start()
      setRecording(true)
    } catch { addMsg('tiby', 'Microphone access denied. Please type your request.') }
  }

  function stopRecording() {
    setTimeout(() => { try { mrRef.current?.stop() } catch {} }, 100)
    setRecording(false)
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#f9f9f8',
      position: 'relative',
    }}>
      {/* Scrollable messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        // Extra padding at bottom so last message isn't hidden behind input bar
        paddingBottom: 90,
        // Smooth scrolling on mobile
        WebkitOverflowScrolling: 'touch',
      }}>
        {messages.map(msg => (
          <div key={msg.id}>
            <div className={`t-bubble-row ${msg.role === 'user' ? 'user' : ''}`}>
              {msg.role === 'tiby' && <div className="t-bubble-av">T</div>}
              {msg.role === 'user' && (
                <div className="t-bubble-av user">
                  {(user?.user_metadata?.full_name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
                </div>
              )}
              <div className="t-bubble" style={{ maxWidth: 'calc(100% - 48px)', wordBreak: 'break-word' }}>
                {msg.text}
              </div>
            </div>
            {msg.type === 'actions' && (
              <div style={{ marginLeft: 40, marginTop: 10 }}>
                <div style={{ border: '1px solid #f0f0ef', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                  {QUICK_ACTIONS.map((a, i) => (
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
                <div className="t-chips" style={{ marginTop: 10 }}>
                  {CHIPS.map(q => (
                    <button key={q.label} className="t-chip" onClick={() => navigate(q.route)}>
                      <i className={`ti ${q.icon}`} aria-hidden="true" />{q.label}
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
              <div className="t-thinking"><span /><span /><span /></div>
            </div>
          </div>
        )}
        {/* Scroll anchor */}
        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      {/* Input bar — fixed at bottom of the chat area */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: '#f9f9f8',
        borderTop: '1px solid #f0f0ef',
        padding: '10px 12px',
        // Push above native bottom bar on iOS/Android
        paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
      }}>
        <div className="t-input-wrap">
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCommand(input) } }}
            placeholder={recording ? 'Listening…' : 'Ask Tiby anything…'}
            disabled={recording || thinking}
            style={{ fontSize: 15 }}
          />
          <button
            className={`t-ib t-ib-mic ${recording ? 'active' : ''}`}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
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
