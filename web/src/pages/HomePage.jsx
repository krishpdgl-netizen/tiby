import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpeech } from '../hooks/useSpeech'
import { getUserContext } from '../services/userProfile'

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''
const API_URL = import.meta.env.VITE_API_URL || 'https://tiby.onrender.com/api/v1'
const GEMINI_API_URL  = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent'
const GEMINI_KEY      = import.meta.env.VITE_GEMINI_KEY || ''

// Persist chat across tab switches using sessionStorage
const STORAGE_KEY = 'tiby_chat_history'

const SYSTEM_PROMPT = `You are Tiby, a smart AI personal assistant. You help users with:
- Scanning business cards and sending follow-up emails
- Recording meetings and generating minutes (MOM)
- Managing tasks and action items
- Answering any question conversationally — productivity, email writing, scheduling advice, etc.

You have access to these actions. When performing one, include JSON at the END of your reply in <action></action> tags:

Navigate:
<action>{"type":"navigate","route":"/scan"}</action>
<action>{"type":"navigate","route":"/meetings"}</action>
<action>{"type":"navigate","route":"/contacts"}</action>
<action>{"type":"navigate","route":"/analytics"}</action>
<action>{"type":"navigate","route":"/settings"}</action>

Task management:
<action>{"type":"add-task","title":"task title","due":"date or TBD","owner":"name or Me"}</action>
<action>{"type":"complete-task","text":"what user said they completed"}</action>

Rules:
- Be warm, smart, concise. Max 2-3 sentences for simple replies.
- Keep context across the conversation — remember what was said earlier.
- If user says "add a task", "remind me to", "follow up with X" → use add-task action.
- If user says "done with X", "completed X", "finished X" → use complete-task action.
- If user asks to open a page, navigate AND confirm in text.
- For general questions (email tips, productivity, etc.) — just answer naturally, no action needed.
- Always confirm actions: "Got it, added to your tasks!" / "Opening card scanner now!"
- Never say you can't do something if it's in your feature list.`

const QUICK_ACTIONS = [
  { icon:'ti-id',         label:'Scan visiting card',   sub:'Extract + draft email',        route:'/scan',      bg:'#fef3c7',color:'#92400e' },
  { icon:'ti-microphone', label:'Record meeting',        sub:'Transcribe + generate MOM',     route:'/meetings',  bg:'#fee2e2',color:'#991b1b' },
  { icon:'ti-chart-bar',  label:'Dashboard & tasks',     sub:'Track action items',            route:'/analytics', bg:'#ede9fe',color:'#5b21b6' },
]

const CHIPS = [
  { icon:'ti-id',         label:'Scan a card',    route:'/scan' },
  { icon:'ti-microphone', label:'Record meeting', route:'/meetings' },
  { icon:'ti-chart-bar',  label:'My tasks',       route:'/analytics' },
  { icon:'ti-users',      label:'Contacts',       route:'/contacts' },
]

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function HomePage({ user }) {
  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there'

  // Restore chat from sessionStorage on mount
  const [messages, setMessages] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch {}
    return [{ id: 1, role:'tiby', type:'actions', text:`${greeting()}, ${firstName}! What would you like to do today?` }]
  })

  const [input, setInput]         = useState('')
  const [recording, setRecording] = useState(false)
  const [thinking, setThinking]   = useState(false)
  const [userCtx, setUserCtx]     = useState({})
  const [geminiHistory, setGeminiHistory] = useState([]) // Gemini conversation history

  const navigate  = useNavigate()
  const { speak } = useSpeech()
  const mrRef     = useRef()
  const chunksRef = useRef([])
  const bottomRef = useRef()
  const streamRef = useRef()

  useEffect(() => { getUserContext().then(setUserCtx) }, [])

  // Persist messages to sessionStorage whenever they change
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50))) } catch {}
  }, [messages])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages, thinking])

  function addMsg(role, text, type='text') {
    setMessages(m => [...m, { id:Date.now()+Math.random(), role, text, type }])
  }

  // ── Gemini call with conversation history ────────────────────────────────
  const callGemini = useCallback(async (userText) => {
    const newHistory = [
      ...geminiHistory,
      { role:'user', parts:[{ text:userText }] }
    ]
    // Keep last 20 turns to avoid token limit
    const trimmed = newHistory.slice(-20)

    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_KEY}`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        system_instruction:{ parts:[{ text:SYSTEM_PROMPT }] },
        contents: trimmed,
        generationConfig:{ temperature:0.7, maxOutputTokens:500 },
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || 'Gemini error')
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I didn't get that. Try again!"

    setGeminiHistory([...trimmed, { role:'model', parts:[{ text:reply }] }])
    return reply
  }, [geminiHistory])

  // ── Parse and execute action tags ────────────────────────────────────────
  const executeAction = useCallback(async (reply) => {
    const match = reply.match(/<action>([\s\S]*?)<\/action>/)
    const cleanReply = reply.replace(/<action>[\s\S]*?<\/action>/g, '').trim()
    if (!match) return cleanReply

    try {
      const action = JSON.parse(match[1])
      const sid = userCtx.sheet_id || null

      if (action.type === 'navigate') {
        setTimeout(() => navigate(action.route), 900)
      }

      if (action.type === 'add-task' && sid) {
        const res = await fetch(APPS_SCRIPT_URL, {
          method:'POST',
          body: JSON.stringify({
            action:'save-task',
            title: action.title,
            due:   action.due   || 'TBD',
            owner: action.owner || 'Me',
            sheet_id: sid,
          }),
        })
        const data = await res.json()
        if (data.status !== 'success') {
          return cleanReply + '\n(Note: Could not save task — check your sheet is set up in Settings)'
        }
      }

      if (action.type === 'complete-task' && sid) {
        await fetch(APPS_SCRIPT_URL, {
          method:'POST',
          body: JSON.stringify({ action:'complete-task', text:action.text, sheet_id:sid }),
        }).catch(()=>{})
      }
    } catch(e) { console.warn('Action parse error:', e) }

    return cleanReply
  }, [userCtx, navigate])

  // ── Handle user input ──────────────────────────────────────────────────
  async function handleCommand(text) {
    if (!text.trim()) return
    addMsg('user', text)
    setInput('')
    setThinking(true)
    try {
      const rawReply   = await callGemini(text)
      const cleanReply = await executeAction(rawReply)
      addMsg('tiby', cleanReply)
      speak(cleanReply.slice(0, 200))
    } catch(e) {
      console.error(e)
      addMsg('tiby', "Something went wrong — check your connection and try again.")
    } finally { setThinking(false) }
  }

  // ── Voice recording ────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true })
      streamRef.current = stream
      chunksRef.current = []
      const mr = new MediaRecorder(stream)
      mrRef.current = mr
      mr.ondataavailable = e => chunksRef.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null
        const blob = new Blob(chunksRef.current, { type:'audio/webm' })
        setThinking(true)
        try {
          const form = new FormData()
          form.append('file', blob, 'voice.webm')
          const res  = await fetch(`${API_URL}/voice/transcribe`, { method:'POST', body:form })
          const data = await res.json()
          if (data.transcript) await handleCommand(data.transcript)
          else addMsg('tiby', "I didn't catch that. Try again or type it!")
        } catch { addMsg('tiby', "Couldn't transcribe. Try typing instead!") }
        finally { setThinking(false) }
      }
      mr.start(); setRecording(true)
    } catch { addMsg('tiby', "Microphone access denied. Please type your request.") }
  }

  function stopRecording() {
    setTimeout(() => { try { mrRef.current?.stop() } catch {} }, 100)
    setRecording(false)
  }

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

            {msg.type==='actions' && (
              <div style={{ marginLeft:37, marginTop:8 }}>
                <div style={{ border:'1px solid #f0f0ef', borderRadius:12, overflow:'hidden', background:'#fff' }}>
                  {QUICK_ACTIONS.map((a,i) => (
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
                  {CHIPS.map(q => (
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

      {/* Input */}
      <div className="t-input-bar">
        <div className="t-input-wrap">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleCommand(input)} }}
            placeholder={recording?'Listening…':'Ask Tiby anything…'}
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
