import { useState, useRef, useEffect } from 'react'
import { transcribeVoice } from '../services/api'
import { useSpeech } from '../hooks/useSpeech'
import { getUserContext } from '../services/userProfile'

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''
const API_URL = import.meta.env.VITE_API_URL || 'https://tiby.onrender.com/api/v1'
const STEP = { SCAN: 0, VOICE: 1, DRAFT: 2, SENT: 3 }

export default function CardScannerPage() {
  const [step, setStep]               = useState(STEP.SCAN)
  const [userCtx, setUserCtx]         = useState({})

  useEffect(() => { getUserContext().then(setUserCtx) }, [])
  const [armed, setArmed]             = useState(false)
  const [dot, setDot]                 = useState('idle')
  const [status, setStatus]           = useState('Ready to scan')
  const [preview, setPreview]         = useState(null)
  const [extracted, setExtracted]     = useState({})
  const [driveUrl, setDriveUrl]       = useState(null)
  const [contact, setContact]         = useState(null)
  const [loading, setLoading]         = useState(false)
  const [recording, setRecording]     = useState(false)
  const [instruction, setInstruction] = useState('')
  const [draft, setDraft]             = useState(null)
  const [sending, setSending]         = useState(false)
  const [sendResult, setSendResult]   = useState(null)

  const videoRef  = useRef(); const streamRef = useRef()
  const mrRef     = useRef(); const chunksRef = useRef([])
  const { speak, stop, isSpeaking } = useSpeech()

  function b64(blob) {
    return new Promise((res,rej) => { const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.onerror=rej; r.readAsDataURL(blob) })
  }
  function resize(canvas, max=640) {
    return new Promise(resolve => {
      const s = Math.min(max/canvas.width, max/canvas.height, 1)
      const out = document.createElement('canvas')
      out.width=Math.round(canvas.width*s); out.height=Math.round(canvas.height*s)
      out.getContext('2d').drawImage(canvas,0,0,out.width,out.height)
      out.toBlob(resolve,'image/jpeg',0.72)
    })
  }

  async function handleScan() {
    if (!armed) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' } })
        streamRef.current = stream; videoRef.current.srcObject = stream
        videoRef.current.style.display = 'block'; setArmed(true)
      } catch { toast('Camera access denied','error') }
      return
    }
    const cv = document.createElement('canvas')
    cv.width=videoRef.current.videoWidth; cv.height=videoRef.current.videoHeight
    cv.getContext('2d').drawImage(videoRef.current,0,0)
    streamRef.current?.getTracks().forEach(t=>t.stop())
    videoRef.current.style.display='none'; setArmed(false)
    const blob = await resize(cv)
    setPreview(URL.createObjectURL(blob))
    setDot('active'); setStatus('Reading card…')
    try {
      const enc = await b64(blob)
      const res = await fetch(APPS_SCRIPT_URL,{ method:'POST', body:JSON.stringify({ image_base64:enc, image_mime:'image/jpeg', image_filename:'card.jpg', sheet_id: userCtx.sheet_id }) })
      const data = await res.json()
      if (data.status==='success') {
        setExtracted(data.fields||{}); setDriveUrl(data.drive_url)
        const n = Object.values(data.fields||{}).filter(Boolean).length
        setDot('done'); setStatus(n ? `${n} detail${n>1?'s':''} extracted — verify below` : 'Card saved — verify details')
      } else { throw new Error(data.message) }
    } catch { setDot('warn'); setStatus('Could not extract — enter details manually') }
  }

  function handleConfirm() { setContact({...extracted, drive_url:driveUrl}); setStep(STEP.VOICE) }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true})
      chunksRef.current=[]
      const mr = new MediaRecorder(stream); mrRef.current=mr
      mr.ondataavailable=e=>chunksRef.current.push(e.data)
      mr.onstop=async()=>{
        stream.getTracks().forEach(t=>t.stop())
        const blob=new Blob(chunksRef.current,{type:'audio/webm'})
        setLoading(true)
        try { const {data}=await transcribeVoice(blob); setInstruction(data.transcript||'') }
        catch { toast('Could not transcribe','error') }
        finally { setLoading(false) }
      }
      mr.start(); setRecording(true)
    } catch { toast('Microphone access denied','error') }
  }
  function stopRec() { mrRef.current?.stop(); setRecording(false) }

  async function handleDraft() {
    if (!instruction.trim()) return toast('Tell me what to write first','error')
    setLoading(true)
    try {
      const res = await fetch(APPS_SCRIPT_URL,{method:'POST',body:JSON.stringify({action:'draft-email',contact,voice_instruction:instruction,sender:userCtx.sender||{},sheet_id:userCtx.sheet_id})})
      const data = await res.json()
      if (data.status!=='success') throw new Error(data.message)
      setDraft(data); setStep(STEP.DRAFT)
      setTimeout(()=>speak(`Subject: ${data.subject}. ${data.body}`.slice(0,600)),400)
    } catch { toast('Failed to draft email','error') }
    finally { setLoading(false) }
  }

  async function handleSend() {
    stop(); setSending(true)
    try {
      const res = await fetch(`${API_URL}/emails/send-quick`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to_email:contact.email,subject:draft.subject,body:draft.body})})
      const data = await res.json()
      setSendResult(data); setStep(STEP.SENT)
      // Save as email pattern for self-improvement
      fetch(APPS_SCRIPT_URL,{method:'POST',body:JSON.stringify({
        action:'save-email', sheet_id:userCtx.sheet_id,
        instruction, subject:draft.subject, body:draft.body,
        contact_name:contact.name, contact_company:contact.company,
      })}).catch(()=>{})
    } catch { toast('Failed to send','error') }
    finally { setSending(false) }
  }

  function reset() {
    stop(); streamRef.current?.getTracks().forEach(t=>t.stop())
    setStep(STEP.SCAN); setArmed(false); setDot('idle'); setStatus('Ready to scan')
    setPreview(null); setExtracted({}); setDriveUrl(null); setContact(null)
    setInstruction(''); setDraft(null); setSendResult(null)
    if(videoRef.current){videoRef.current.style.display='none';videoRef.current.srcObject=null}
  }

  const hasFields = Object.values(extracted).some(Boolean)

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>

      {/* Step bar */}
      <div>
        <div className="t-steps">
          {['Scan','Email','Done'].map((_,i)=>(
            <div key={i} className="t-step-bar" style={{ background: step>i?'#1a1a1a':step===i?'#6b7280':'#e5e5e4' }} />
          ))}
        </div>
        <div className="t-step-labels">
          {['Scan','Email','Done'].map((l,i)=>(
            <span key={i} className={step===i?'t-step-active':''}>{l}</span>
          ))}
        </div>
      </div>

      {/* ── SCAN ── */}
      {step===STEP.SCAN && (
        <div className="t-card">
          <div className="t-card-head">
            <div className="t-icon ti-amber"><i className="ti ti-id" aria-hidden="true"/></div>
            <div><div className="t-ct">Visiting card</div><div className="t-cs">Scan to extract contact details</div></div>
          </div>

          <div className="t-camera-preview" style={{ display: preview||armed ? 'block':'flex' }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ display:'none',width:'100%',height:'100%',objectFit:'cover',borderRadius:12 }} />
            {preview && <img src={preview} style={{ width:'100%',height:'100%',objectFit:'cover',borderRadius:12 }} alt="Card" />}
            {!preview && !armed && (
              <>
                <i className="ti ti-id" style={{ fontSize:40,color:'#d1d5db' }} aria-hidden="true"/>
                <span style={{ fontSize:13,color:'#9ca3af',marginTop:6 }}>Camera preview</span>
              </>
            )}
          </div>

          <button className={`t-btn ${dot==='done'?'t-btn-green':'t-btn-primary'}`} onClick={handleScan}>
            <i className={`ti ${armed?'ti-camera-selfie':dot==='done'?'ti-refresh':'ti-camera'}`} aria-hidden="true"/>
            {armed ? 'Snap card' : dot==='done' ? 'Rescan' : 'Scan visiting card'}
          </button>

          <div className="t-dot-row">
            <span className={`t-dot t-dot-${dot}`}/>
            <span>{status}</span>
            {driveUrl && <a href={driveUrl} target="_blank" rel="noreferrer" style={{ marginLeft:'auto',fontSize:12,color:'#1a73e8',textDecoration:'none' }}>Drive ↗</a>}
          </div>

          {hasFields && (
            <div className="t-ef">
              <div className="t-ef-head">Extracted details</div>
              {[['Name','name'],['Role','role'],['Email','email'],['Phone','phone'],['Company','company'],['Website','website']].map(([l,k])=>
                extracted[k] ? (
                  <div key={k} className="t-ef-row">
                    <span className="t-ef-key">{l}</span>
                    <span style={{ flex:1 }}>
                      <input defaultValue={extracted[k]} onChange={e=>setExtracted(p=>({...p,[k]:e.target.value}))} />
                    </span>
                  </div>
                ) : null
              )}
            </div>
          )}

          {hasFields && (
            <button className="t-btn t-btn-primary" style={{ marginTop:12 }} onClick={handleConfirm}>
              <i className="ti ti-mail" aria-hidden="true"/> Save and write email
            </button>
          )}
        </div>
      )}

      {/* ── VOICE ── */}
      {step===STEP.VOICE && contact && (
        <div className="t-card">
          <div className="t-card-head">
            <div className="t-icon ti-green"><i className="ti ti-microphone" aria-hidden="true"/></div>
            <div><div className="t-ct">What should the email say?</div><div className="t-cs">To {contact.name||contact.email||'contact'}</div></div>
          </div>

          <button className={`t-btn ${recording?'t-btn-red':'t-btn-ghost'}`}
            onMouseDown={startRec} onMouseUp={stopRec} onTouchStart={startRec} onTouchEnd={stopRec}
            style={{ userSelect:'none' }}>
            <i className={`ti ${recording?'ti-microphone-off':'ti-microphone'}`} aria-hidden="true"/>
            {recording ? 'Release to stop' : 'Hold to speak'}
          </button>

          {loading && <div className="t-dot-row"><span className="t-dot t-dot-active"/><span>Transcribing…</span></div>}

          <textarea className="t-input" rows={3} placeholder="Or type your instruction here…"
            value={instruction} onChange={e=>setInstruction(e.target.value)}
            style={{ marginTop:10,resize:'vertical',minHeight:80 }} />

          <button className="t-btn t-btn-primary" onClick={handleDraft} disabled={loading||!instruction.trim()}>
            {loading?'Drafting…':<><i className="ti ti-wand" aria-hidden="true"/> Draft email</>}
          </button>
          <button className="t-btn t-btn-ghost" onClick={()=>setStep(STEP.SCAN)}>← Back</button>
        </div>
      )}

      {/* ── DRAFT ── */}
      {step===STEP.DRAFT && draft && (
        <div className="t-card">
          <div className="t-card-head">
            <div className="t-icon ti-blue"><i className="ti ti-mail" aria-hidden="true"/></div>
            <div style={{ flex:1 }}>
              <div className="t-ct">Email draft</div>
              <div className="t-cs">{isSpeaking?'Reading aloud…':'Review and send'}</div>
            </div>
            <button onClick={isSpeaking?stop:()=>speak(`Subject: ${draft.subject}. ${draft.body}`.slice(0,600))}
              style={{ background:'none',border:'1px solid #e5e5e4',borderRadius:8,padding:'5px 10px',fontSize:12,cursor:'pointer',color:'#6b7280',fontFamily:'inherit' }}>
              {isSpeaking?'Stop':'▶ Replay'}
            </button>
          </div>

          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:11,fontWeight:600,color:'#6b7280',display:'block',marginBottom:4,textTransform:'uppercase',letterSpacing:'.3px' }}>Subject</label>
            <input className="t-input" value={draft.subject} onChange={e=>setDraft(d=>({...d,subject:e.target.value}))} />
          </div>
          <div>
            <label style={{ fontSize:11,fontWeight:600,color:'#6b7280',display:'block',marginBottom:4,textTransform:'uppercase',letterSpacing:'.3px' }}>Body</label>
            <textarea className="t-input" rows={7} value={draft.body} onChange={e=>setDraft(d=>({...d,body:e.target.value}))} style={{ resize:'vertical' }} />
          </div>

          <button className="t-btn t-btn-primary" onClick={handleSend} disabled={sending}>
            {sending?'Sending…':<><i className="ti ti-send" aria-hidden="true"/> Send email</>}
          </button>
          <button className="t-btn t-btn-ghost" onClick={()=>{stop();setStep(STEP.VOICE)}}>← Edit instruction</button>
        </div>
      )}

      {/* ── SENT ── */}
      {step===STEP.SENT && (
        <div className="t-card">
          {sendResult?.method==='gmail' ? (
            <div style={{ textAlign:'center',padding:'24px 0' }}>
              <div style={{ fontSize:44,marginBottom:12 }}>✅</div>
              <div className="t-ct" style={{ fontSize:16 }}>Email sent!</div>
              <div className="t-cs" style={{ marginTop:4 }}>Delivered to {contact?.name}</div>
            </div>
          ) : (
            <>
              <div className="t-card-head">
                <div className="t-icon ti-amber"><i className="ti ti-info-circle" aria-hidden="true"/></div>
                <div><div className="t-ct">Gmail not connected yet</div><div className="t-cs">Use one of these to send</div></div>
              </div>
              <a href={sendResult?.mailto} className="t-btn t-btn-primary" style={{ textDecoration:'none',display:'flex' }}>
                <i className="ti ti-mail" aria-hidden="true"/> Open in mail app
              </a>
              <button className="t-btn t-btn-ghost" onClick={()=>{navigator.clipboard.writeText(draft?.body||'');toast('Copied!','success')}}>
                <i className="ti ti-copy" aria-hidden="true"/> Copy email body
              </button>
              {contact?.drive_url && (
                <div style={{ marginTop:12,padding:11,background:'#f0fdf4',borderRadius:10,fontSize:13 }}>
                  Card saved → <a href={contact.drive_url} target="_blank" rel="noreferrer" style={{ color:'#065f46' }}>View in Drive ↗</a>
                </div>
              )}
            </>
          )}
          <button className="t-btn t-btn-ghost" style={{ marginTop:12 }} onClick={reset}>
            <i className="ti ti-refresh" aria-hidden="true"/> Scan another card
          </button>
        </div>
      )}
    </div>
  )
}

function toast(msg,type='info') {
  let el=document.getElementById('t-toast')
  if(!el){el=document.createElement('div');el.id='t-toast';document.body.appendChild(el)}
  el.textContent=msg
  el.className=type==='error'?'error':type==='success'?'success':''
  el.classList.add('show')
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),3000)
}
