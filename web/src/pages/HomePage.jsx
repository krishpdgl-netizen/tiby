import { useState, useRef, useEffect } from 'react'
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
  const firstName=user?.user_metadata?.full_name?.split(' ')[0]||user?.email?.split('@')[0]||'there'
  const [messages,setMessages]=useState(()=>{try{const s=sessionStorage.getItem(STORAGE_KEY);if(s)return JSON.parse(s)}catch{}return[{id:1,role:'tiby',type:'actions',text:`${greeting()}, ${firstName}! What would you like to do today?`}]})
  const [input,setInput]=useState(''); const [recording,setRecording]=useState(false); const [thinking,setThinking]=useState(false)
  const navigate=useNavigate(); const {speak}=useSpeech(); const mrRef=useRef(); const chunksRef=useRef([]); const bottomRef=useRef(); const streamRef=useRef()
  useEffect(()=>{try{sessionStorage.setItem(STORAGE_KEY,JSON.stringify(messages.slice(-50)))}catch{}},[messages])
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'})},[messages,thinking])
  function addMsg(role,text,type='text'){setMessages(m=>[...m,{id:Date.now()+Math.random(),role,text,type}])}
  function serverHistory(){return messages.filter(m=>m.type!=='actions').slice(-20).map(m=>({role:m.role==='tiby'?'assistant':'user',content:m.text}))}
  async function handleCommand(text){
    if(!text.trim()||thinking)return
    const history=serverHistory(); addMsg('user',text); setInput(''); setThinking(true)
    try{
      const {data}=await agentChat(text,history)
      addMsg('tiby',data.reply||'Done.')
      for(const action of data.actions||[]){if(action.type==='navigate'&&action.ok&&action.route)setTimeout(()=>navigate(action.route),700)}
      speak((data.reply||'Done.').slice(0,200))
    }catch(e){console.error(e);addMsg('tiby',e?.response?.status===429?'I’m receiving too many requests right now. Try again in a moment.':'Something went wrong — check your connection and try again.')}
    finally{setThinking(false)}
  }
  async function startRecording(){
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});streamRef.current=stream;chunksRef.current=[];const mr=new MediaRecorder(stream);mrRef.current=mr;mr.ondataavailable=e=>{if(e.data.size)chunksRef.current.push(e.data)};mr.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());streamRef.current=null;const blob=new Blob(chunksRef.current,{type:'audio/webm'});setThinking(true);try{const {data}=await transcribeVoice(blob);if(data.transcript)await handleCommand(data.transcript);else addMsg('tiby',"I didn't catch that. Try again or type it!")}catch{addMsg('tiby',"Couldn't transcribe. Try typing instead!")}finally{setThinking(false)}};mr.start();setRecording(true)}catch{addMsg('tiby','Microphone access denied. Please type your request.')}
  }
  function stopRecording(){setTimeout(()=>{try{mrRef.current?.stop()}catch{}},100);setRecording(false)}

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#f9f9f8' }}>
      <div style={{ flex:1, overflowY:'auto', padding:'20px 16px 8px', display:'flex', flexDirection:'column', gap:14 }}>
        {messages.map(msg => (
          <div key={msg.id}>
            <div className={`t-bubble-row ${msg.role==='user'?'user':''}`}>
              {msg.role==='tiby' && <div className="t-bubble-av">T</div>}
              {msg.role==='user' && <div className="t-bubble-av user">{(user?.user_metadata?.full_name?.[0]||user?.email?.[0]||'U').toUpperCase()}</div>}
              <div className="t-bubble">{msg.text}</div>
            </div>
            {msg.type==='actions' && (
              <div style={{ marginLeft:37, marginTop:8 }}>
                <div style={{ border:'1px solid #f0f0ef', borderRadius:12, overflow:'hidden', background:'#fff' }}>
                  {QUICK_ACTIONS.map((a,i)=>(<button key={i} className="t-action-row" onClick={()=>navigate(a.route)}><div className="t-action-row-icon" style={{background:a.bg,color:a.color}}><i className={`ti ${a.icon}`} aria-hidden="true"/></div><div><div className="t-action-row-name">{a.label}</div><div className="t-action-row-sub">{a.sub}</div></div><i className="ti ti-chevron-right" aria-hidden="true" style={{marginLeft:'auto',fontSize:14,color:'#9ca3af'}}/></button>))}
                </div>
                <div className="t-chips" style={{marginTop:10}}>{CHIPS.map(q=>(<button key={q.label} className="t-chip" onClick={()=>navigate(q.route)}><i className={`ti ${q.icon}`} aria-hidden="true"/>{q.label}</button>))}</div>
              </div>
            )}
          </div>
        ))}
        {thinking&&<div className="t-bubble-row"><div className="t-bubble-av">T</div><div style={{background:'#fff',border:'1px solid #f0f0ef',borderRadius:'4px 14px 14px 14px'}}><div className="t-thinking"><span/><span/><span/></div></div></div>}
        <div ref={bottomRef}/>
      </div>
      <div className="t-input-bar"><div className="t-input-wrap"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleCommand(input)}}} placeholder={recording?'Listening…':'Ask Tiby anything…'} disabled={recording||thinking}/><button className={`t-ib t-ib-mic ${recording?'active':''}`} onMouseDown={startRecording} onMouseUp={stopRecording} onTouchStart={startRecording} onTouchEnd={stopRecording} aria-label="Hold to speak"><i className={`ti ${recording?'ti-microphone-off':'ti-microphone'}`} aria-hidden="true"/></button><button className="t-ib t-ib-send" onClick={()=>handleCommand(input)} disabled={!input.trim()||thinking} aria-label="Send"><i className="ti ti-arrow-up" aria-hidden="true"/></button></div></div>
    </div>
  )
}
