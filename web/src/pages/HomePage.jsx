import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpeech } from '../hooks/useSpeech'
import { getUserContext } from '../services/userProfile'

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''
const GEMINI_API_URL  = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent'
const GEMINI_KEY      = import.meta.env.VITE_GEMINI_KEY || ''

const SYSTEM_PROMPT = `You are Tiby, a smart AI personal assistant built into a PWA. You help users with:
- Scanning business cards and sending follow-up emails
- Recording meetings and generating minutes (MOM)
- Managing tasks and action items
- Answering general questions conversationally

You have access to these actions. When you want to perform one, include it as JSON at the END of your reply wrapped in <action></action> tags:

Navigate actions (send user to a page):
<action>{"type":"navigate","route":"/scan"}</action>          → card scanner
<action>{"type":"navigate","route":"/meetings"}</action>      → meetings
<action>{"type":"navigate","route":"/contacts"}</action>      → contacts
<action>{"type":"navigate","route":"/analytics"}</action>     → dashboard & tasks
<action>{"type":"navigate","route":"/settings"}</action>      → settings

Task actions:
<action>{"type":"add-task","title":"task name","due":"date or TBD","owner":"name or me"}</action>
<action>{"type":"complete-task","text":"what the user said they completed"}</action>

Rules:
- Be conversational, warm, concise. Max 2-3 sentences unless asked for more.
- Always respond in the same language the user uses.
- If user asks to open something, navigate AND briefly confirm ("Opening card scanner now!").
- If user adds a task, confirm it ("Got it, added that to your tasks!").
- If user says they completed something, mark it done and confirm.
- Answer general questions (productivity tips, email advice, etc.) normally without any action tag.
- If unsure what feature they need, ask a clarifying question.
- Never say you can't do something if it's in your feature list.`

const ACTIONS = [
  { icon: 'ti-id',         label: 'Scan visiting card',    sub: 'Extract contact + draft email',  route: '/scan',      bg: '#fef3c7', color: '#92400e' },
  { icon: 'ti-microphone', label: 'Record meeting',         sub: 'Transcribe + generate MOM',       route: '/meetings',  bg: '#fee2e2', color: '#991b1b' },
  { icon: 'ti-chart-bar',  label: 'Dashboard & tasks',      sub: 'Track action items + priorities', route: '/analytics', bg: '#ede9fe', color: '#5b21b6' },
]

const QUICK = [
  { icon: 'ti-id',         label: 'Scan a card',    route: '/scan' },
  { icon: 'ti-microphone', label: 'Record meeting', route: '/meetings' },
  { icon: 'ti-chart-bar',  label: 'My tasks',       route: '/analytics' },
  { icon: 'ti-users',      label: 'Contacts',       route: '/contacts' },
]

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function HomePage({ user }) {
  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there'

  const [messages, setMessages] = useState([
    { id: 1, role: 'tiby', type: 'actions', text: `${greeting()}, ${firstName}! What would you like to do today?` }
  ])
  const [input, setInput]         = useState('')
  const [recording, setRecording] = useState(false)
  const [thinking, setThinking]   = useState(false)
  const [userCtx, setUserCtx]     = useState({})
  const [history, setHistory]     = useState([]) // Gemini conversation history

  const navigate  = useNavigate()
  const { speak } = useSpeech()
  const mrRef     = useRef()
  const chunksRef = useRef([])
  const bottomRef = useRef()
  const inputRef  = useRef()

  useEffect(() => { getUserContext().then(setUserCtx) }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  function addMsg(role, text, type = 'text') {
    setMessages(m => [...m, { id: Date.now() + Math.random(), role, text, type }])
  }

  // ── Call Gemini with full conversation history ─────────────────────────────
  async function callGemini(userText) {
    const newHistory = [
      ...history,
      { role: 'user', parts: [{ text: userText }] }
    ]

    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: newHistory,
        generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
      }),
    })

    const data = await res.json()
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I didn't catch that, could you try again?"

    // Update history
    setHistory([
      ...newHistory,
      { role: 'model', parts: [{ text: reply }] }
    ])

    return reply
  }

  // ── Parse and execute action tags ─────────────────────────────────────────
  async function executeAction(reply) {
    const actionMatch = reply.match(/<action>(.*?)<\/action>/s)
    if (!actionMatch) return reply

    const cleanReply = reply.replace(/<action>.*?<\/action>/s, '').trim()

    try {
      const action = JSON.parse(actionMatch[1])

      if (action.type === 'navigate') {
        setTimeout(() => navigate(action.route), 900)
      }

      if (action.type === 'add-task') {
        // Add task to Apps Script
        const sid = userCtx.sheet_id || ''
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'generate-mom', // reuse MOM endpoint to save tasks
            transcript: `Task: ${action.title}`,
            meeting_title: 'Manual task',
            sheet_id: sid,
          }),
        }).catch(() => {})

        // Actually save directly as a task
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({
            action:    'save-task',
            title:     action.title,
            due:       action.due    || 'TBD',
            owner:     action.owner  || 'Me',
            sheet_id:  sid,
          }),
        }).catch(() => {})
      }

      if (action.type === 'complete-task') {
        const sid = userCtx.sheet_id || ''
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'complete-task', text: action.text, sheet_id: sid }),
        }).catch(() => {})
      }
    } catch {}

    return cleanReply
  }

  // ── Handle user message ────────────────────────────────────────────────────
  async function handleCommand(text) {
    if (!text.trim()) return
    addMsg('user', text)
    setInput('')
    setThinking(true)

    try {
      const rawReply  = await callGemini(text)
      const cleanReply = await executeAction(rawReply)
      addMsg('tiby', cleanReply)
      speak(cleanReply.slice(0, 200))
    } catch(e) {
      addMsg('tiby', "Sorry, something went wrong. Try again!")
    } finally {
      setThinking(false)
    }
  }

  // ── Voice recording ────────────────────────────────────────────────────────
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
          const API_URL = import.meta.env.VITE_API_URL || 'https://tiby.onrender.com/api/v1'
          const form = new FormData()
          form.append('file', blob, 'voice.webm')
          const res  = await fetch(`${API_URL}/voice/transcribe`, { method: 'POST', body: form })
          const data = await res.json()
          if (data.transcript) await handleCommand(data.transcript)
          else addMsg('tiby', "I didn't catch that. Try typing instead!")
        } catch {
          addMsg('tiby', "Couldn't transcribe. Try typing!")
        } finally { setThinking(false) }
      }
      mr.start(); setRecording(true)
    } catch {
      addMsg('tiby', "Microphone access denied. Please type your request.")
    }
  }

  function stopRecording() { mrRef.current?.stop(); setRecording(false) }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#f9f9f8' }}>

      {/* Messages */}
      <div style={{ flex:1, overflowY:'auto', padding:'20px 16px 8px', display:'flex', flexDirection:'column', gap:14 }}>
        {messages.map(msg => (
          <div key={msg.id}>
            <div className={`t-bubble-row ${msg.role==='user'?'user':''}`}>
              {msg.role==='tiby' && <div className="t-bubble-av">T</div>}
              {msg.role==='user' && (
                <div className="t-bubble-av user">
                  {(user?.user_metadata?.full_name?.[0]||user?.email?.[0]||'U').toUpperCase()}
                </div>
              )}
              <div className="t-bubble">{msg.text}</div>
            </div>

            {/* Action cards on first message */}
            {msg.type==='actions' && (
              <div style={{ marginLeft:37, marginTop:8 }}>
                <div style={{ border:'1px solid #f0f0ef', borderRadius:12, overflow:'hidden', background:'#fff' }}>
                  {ACTIONS.map((a,i) => (
                    <button key={i} className="t-action-row" onClick={()=>navigate(a.route)}>
                      <div className="t-action-row-icon" style={{ background:a.bg, color:a.color }}>
                        <i className={`ti ${a.icon}`} aria-hidden="true"/>
                      </div>
                      <div>
                        <div className="t-action-row-name">{a.label}</div>
                        <div className="t-action-row-sub">{a.sub}</div>
                      </div>
                      <i className="ti ti-chevron-right" aria-hidden="true" style={{ marginLeft:'auto', fontSize:14, color:'#9ca3af' }}/>
                    </button>
                  ))}
                </div>
                <div className="t-chips" style={{ marginTop:10 }}>
                  {QUICK.map(q => (
                    <button key={q.label} className="t-chip" onClick={()=>navigate(q.route)}>
                      <i className={`ti ${q.icon}`} aria-hidden="true"/>
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
            <div style={{ background:'#fff', border:'1px solid #f0f0ef', borderRadius:'4px 14px 14px 14px' }}>
              <div className="t-thinking"><span/><span/><span/></div>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input bar */}
      <div className="t-input-bar">
        <div className="t-input-wrap">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleCommand(input)} }}
            placeholder={recording ? 'Listening…' : 'Ask Tiby anything…'}
            disabled={recording||thinking}
          />
          <button
            className={`t-ib t-ib-mic ${recording?'active':''}`}
            onMouseDown={startRecording} onMouseUp={stopRecording}
            onTouchStart={startRecording} onTouchEnd={stopRecording}
            aria-label="Hold to speak"
          >
            <i className={`ti ${recording?'ti-microphone-off':'ti-microphone'}`} aria-hidden="true"/>
          </button>
          <button className="t-ib t-ib-send" onClick={()=>handleCommand(input)}
            disabled={!input.trim()||thinking} aria-label="Send">
            <i className="ti ti-arrow-up" aria-hidden="true"/>
          </button>
        </div>
      </div>
    </div>
  )
}
