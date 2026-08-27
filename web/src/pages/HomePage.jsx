import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpeech } from '../hooks/useSpeech'
import { agentChat, transcribeVoice, bustCache, exportContacts } from '../services/api'

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

  function addMsg(role, text, type = 'text', url = null) {
    setMessages(m => [...m, { id: Date.now() + Math.random(), role, text, type, url }])
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
        // Bust contacts cache when bot updates/adds a contact
        if (['add_contact', 'update_contact'].includes(action.type) && action.ok) {
          bustCache('contacts')
        }
        // Export contacts when bot is asked
        if (action.type === 'export_contacts' && action.ok) {
          try {
            const res = await exportContacts()
            const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
            const a = document.createElement('a'); a.href = url; a.download = 'tiby-contacts.csv'
            document.body.appendChild(a); a.click()
            setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a) }, 100)
          } catch {}
        }
        // For call/whatsapp/email — add a tappable action card to the chat
        if (['call_contact', 'whatsapp_contact', 'email_contact'].includes(action.type) && action.url) {
          const icons = { call_contact: '📞', whatsapp_contact: '💬', email_contact: '✉️' }
          const labels = { call_contact: `Call ${action.name}`, whatsapp_contact: `Open WhatsApp — ${action.name}`, email_contact: `Email ${action.name}` }
          addMsg('action_link', labels[action.type] || 'Open', 'action_link', action.url)
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
              {msg.role === 'tiby' && <div className="t-bubble-av"><svg width="14" height="14" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M256,105 C316,105 407,196 407,256 C330,256 256,216 256,105Z" stroke="white" stroke-width="40" stroke-linejoin="round"/><path d="M256,105 C196,105 105,196 105,256 C182,256 256,216 256,105Z" stroke="white" stroke-width="40" stroke-linejoin="round"/><path d="M256,407 C316,407 407,316 407,256 C330,256 256,296 256,407Z" stroke="white" stroke-width="40" stroke-linejoin="round"/><path d="M256,407 C196,407 105,316 105,256 C182,256 256,296 256,407Z" stroke="white" stroke-width="40" stroke-linejoin="round"/><rect x="214" y="214" width="84" height="84" rx="6" stroke="white" stroke-width="32" transform="rotate(45 256 256)"/></svg></div>}
              {msg.role === 'user' && (
                <div className="t-bubble-av user">
                  {(user?.user_metadata?.full_name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
                </div>
              )}
              {msg.type === 'action_link' ? (
                <a href={msg.url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#1a1a1a', color: '#fff', borderRadius: '4px 14px 14px 14px', textDecoration: 'none', fontSize: 14, fontWeight: 600, maxWidth: 'calc(100% - 48px)' }}>
                  {msg.text}
                  <i className="ti ti-arrow-right" style={{ fontSize: 14 }} aria-hidden="true" />
                </a>
              ) : (
                <div className="t-bubble" style={{ maxWidth: 'calc(100% - 48px)', wordBreak: 'break-word' }}>
                  {msg.text}
                </div>
              )}
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
            <div className="t-bubble-av"><svg width="14" height="14" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M256,105 C316,105 407,196 407,256 C330,256 256,216 256,105Z" stroke="white" stroke-width="40" stroke-linejoin="round"/><path d="M256,105 C196,105 105,196 105,256 C182,256 256,216 256,105Z" stroke="white" stroke-width="40" stroke-linejoin="round"/><path d="M256,407 C316,407 407,316 407,256 C330,256 256,296 256,407Z" stroke="white" stroke-width="40" stroke-linejoin="round"/><path d="M256,407 C196,407 105,316 105,256 C182,256 256,296 256,407Z" stroke="white" stroke-width="40" stroke-linejoin="round"/><rect x="214" y="214" width="84" height="84" rx="6" stroke="white" stroke-width="32" transform="rotate(45 256 256)"/></svg></div>
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
