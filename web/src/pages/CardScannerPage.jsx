import { useState, useRef, useEffect } from 'react'
import { scanCard, confirmContact, draftEmail, sendEmail, draftQuickEmail, sendQuickEmail, transcribeVoice } from '../services/api'
import { useSpeech } from '../hooks/useSpeech'

const STEP = { SCAN: 0, VOICE: 1, DRAFT: 2, SENT: 3 }

const CATEGORIES = [
  'Friends (old customers)',
  'China OEM 2026',
  'OEM Bulk Customers 2026',
  'Consultants / Service Provider (Insurance, Funding, Governing, Rating, Testing Lab)',
  'Supplier / Service',
  'Others',
]

export default function CardScannerPage() {
  const [step, setStep]               = useState(STEP.SCAN)
  const [armed, setArmed]             = useState(false)
  const [dot, setDot]                 = useState('idle')
  const [status, setStatus]           = useState('Ready to scan')
  const [preview, setPreview]         = useState(null)
  const [extracted, setExtracted]     = useState({})
  const [imagePath, setImagePath]     = useState(null)
  const [imageUrl, setImageUrl]       = useState(null)
  const [contactId, setContactId]     = useState(null)
  const [contactData, setContactData] = useState(null)
  const [loading, setLoading]         = useState(false)
  const [recording, setRecording]     = useState(false)
  const [instruction, setInstruction] = useState('')
  const [draft, setDraft]             = useState(null)
  const [sending, setSending]         = useState(false)
  const [sendResult, setSendResult]   = useState(null)
  const [category, setCategory]       = useState('')

  const videoRef  = useRef(); const streamRef = useRef()
  const mrRef     = useRef(); const chunksRef = useRef([])
  const { speak, stop, isSpeaking } = useSpeech()

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
      try { mrRef.current?.stop() } catch {}
    }
  }, [])

  function resize(canvas, max=640) {
    return new Promise(resolve=>{
      const s=Math.min(max/canvas.width,max/canvas.height,1)
      const out=document.createElement('canvas')
      out.width=Math.round(canvas.width*s);out.height=Math.round(canvas.height*s)
      out.getContext('2d').drawImage(canvas,0,0,out.width,out.height)
      out.toBlob(resolve,'image/jpeg',0.82)
    })
  }

  async function handleScan() {
    if (!armed) {
      try {
        const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}})
        streamRef.current=stream;videoRef.current.srcObject=stream
        videoRef.current.style.display='block';setArmed(true)
      } catch { toast('Camera access denied','error') }
      return
    }
    const cv=document.createElement('canvas')
    cv.width=videoRef.current.videoWidth;cv.height=videoRef.current.videoHeight
    cv.getContext('2d').drawImage(videoRef.current,0,0)
    streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null
    videoRef.current.style.display='none';setArmed(false)
    const blob=await resize(cv)
    setPreview(URL.createObjectURL(blob))
    setDot('active');setStatus('Reading card…')
    try {
      const imageFile = new File([blob], 'card.jpg', { type:'image/jpeg' })
      const { data } = await scanCard(imageFile)
      setExtracted(data.extracted || {})
      setImagePath(data.image_path)
      setImageUrl(data.image_url)
      const n = Object.values(data.extracted||{}).filter(Boolean).length
      setDot('done'); setStatus(n ? `${n} detail${n>1?'s':''} extracted` : 'Card saved — enter details manually')
    } catch(e) { setDot('warn'); setStatus('Could not extract — enter details manually') }
  }

  async function handleConfirm() {
    if (!category) return toast('Please select a category first', 'error')
    setLoading(true)
    try {
      const { data } = await confirmContact(extracted, imagePath, {}, category)
      setContactId(data.id)
      setContactData(data.contact)
      setStep(STEP.VOICE)
    } catch { toast('Failed to save contact','error') }
    finally { setLoading(false) }
  }

  async function startRec() {
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true})
      chunksRef.current=[]
      const mr=new MediaRecorder(stream);mrRef.current=mr
      mr.ondataavailable=e=>chunksRef.current.push(e.data)
      mr.onstop=async()=>{
        stream.getTracks().forEach(t=>t.stop())
        const blob=new Blob(chunksRef.current,{type:'audio/webm'})
        setLoading(true)
        try{const {data}=await transcribeVoice(blob);setInstruction(data.transcript||'')}
        catch{toast('Could not transcribe','error')}
        finally{setLoading(false)}
      }
      mr.start();setRecording(true)
    } catch{toast('Microphone access denied','error')}
  }
  function stopRec(){setTimeout(()=>{try{mrRef.current?.stop()}catch{}},100);setRecording(false)}

  async function handleDraft() {
    if(!instruction.trim())return toast('Tell me what to write first','error')
    setLoading(true)
    try {
      let data
      if (contactId) {
        const res = await draftEmail(contactId, instruction)
        data = res.data
      } else {
        const res = await draftQuickEmail(extracted, instruction)
        data = res.data
      }
      setDraft(data);setStep(STEP.DRAFT)
      setTimeout(()=>speak(`Subject: ${data.subject}. ${data.body}`.slice(0,600)),400)
    } catch{toast('Failed to draft email','error')}
    finally{setLoading(false)}
  }

  async function handleSend() {
    stop();setSending(true)
    try {
      let data
      if (contactId) {
        const res = await sendEmail(contactId, draft.subject, draft.body, instruction)
        data = res.data
      } else {
        const res = await sendQuickEmail(extracted.email, draft.subject, draft.body)
        data = res.data
      }
      setSendResult(data);setStep(STEP.SENT)
    } catch{toast('Failed to send','error')}
    finally{setSending(false)}
  }

  function reset() {
    stop();streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null
    setStep(STEP.SCAN);setArmed(false);setDot('idle');setStatus('Ready to scan')
    setPreview(null);setExtracted({});setImagePath(null);setImageUrl(null)
    setContactId(null);setContactData(null);setInstruction('');setDraft(null);setSendResult(null)
    setCategory('')
    if(videoRef.current){videoRef.current.style.display='none';videoRef.current.srcObject=null}
  }

  const hasFields = Object.values(extracted).some(Boolean)

  return (
    <div className="t-content" style={{paddingTop:16}}>
      <div>
        <div className="t-steps">
          {['Scan','Email','Done'].map((_,i)=>(
            <div key={i} className="t-step-bar" style={{background:step>i?'#1a1a1a':step===i?'#6b7280':'#e5e5e4'}}/>
          ))}
        </div>
        <div className="t-step-labels">
          {['Scan','Email','Done'].map((l,i)=>(<span key={i} className={step===i?'t-step-active':''}>{l}</span>))}
        </div>
      </div>

      {step===STEP.SCAN&&(
        <div className="t-card">
          <div className="t-card-head">
            <div className="t-icon ti-amber"><i className="ti ti-id" aria-hidden="true"/></div>
            <div><div className="t-ct">Visiting card</div><div className="t-cs">Scan to extract contact details</div></div>
          </div>
          <div className="t-camera-preview" style={{display:preview||armed?'block':'flex'}}>
            <video ref={videoRef} autoPlay playsInline muted style={{display:'none',width:'100%',height:'100%',objectFit:'cover',borderRadius:12}}/>
            {preview&&<img src={preview} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:12}} alt="Card"/>}
            {!preview&&!armed&&<><i className="ti ti-id" style={{fontSize:40,color:'#d1d5db'}} aria-hidden="true"/><span style={{fontSize:13,color:'#9ca3af',marginTop:6}}>Camera preview</span></>}
          </div>
          <button className={`t-btn ${dot==='done'?'t-btn-green':'t-btn-primary'}`} onClick={handleScan}>
            <i className={`ti ${armed?'ti-camera-selfie':dot==='done'?'ti-refresh':'ti-camera'}`} aria-hidden="true"/>
            {armed?'Snap card':dot==='done'?'Rescan':'Scan visiting card'}
          </button>
          <div className="t-dot-row">
            <span className={`t-dot t-dot-${dot}`}/>
            <span>{status}</span>
            {imageUrl&&<a href={imageUrl} target="_blank" rel="noreferrer" style={{marginLeft:'auto',fontSize:12,color:'#1a73e8',textDecoration:'none'}}>Preview ↗</a>}
          </div>
          {hasFields&&(
            <div className="t-ef">
              <div className="t-ef-head">Extracted details</div>
              {[['Name','name'],['Role','role'],['Email','email'],['Phone','phone'],['Company','company'],['Website','website']].map(([l,k])=>(
                <div key={k} className="t-ef-row">
                  <span className="t-ef-key">{l}</span>
                  <span style={{flex:1}}>
                    <input value={extracted[k]||''} onChange={e=>setExtracted(p=>({...p,[k]:e.target.value}))} placeholder={`Enter ${l.toLowerCase()}…`}/>
                  </span>
                </div>
              ))}

              {/* Category picker */}
              <div className="t-ef-row" style={{alignItems:'flex-start', paddingTop:10}}>
                <span className="t-ef-key" style={{paddingTop:8}}>Category</span>
                <div style={{flex:1, display:'flex', flexDirection:'column', gap:6}}>
                  {CATEGORIES.map(cat => (
                    <label key={cat} style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'6px 10px', borderRadius:9, background: category===cat ? '#1a1a1a' : '#f9f9f8', border: `1px solid ${category===cat ? '#1a1a1a' : '#e5e5e4'}`, transition:'all .12s'}}>
                      <input type="radio" name="category" value={cat} checked={category===cat} onChange={()=>setCategory(cat)} style={{accentColor:'#1a1a1a', width:15, height:15}}/>
                      <span style={{fontSize:13, color: category===cat ? '#fff' : '#1a1a1a', fontWeight: category===cat ? 600 : 400}}>{cat}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          {hasFields&&(
            <button className="t-btn t-btn-primary" style={{marginTop:12}} onClick={handleConfirm} disabled={loading||!category}>
              {loading?'Saving…':<><i className="ti ti-mail" aria-hidden="true"/> Save and write email</>}
            </button>
          )}
          {hasFields && !category && (
            <p style={{fontSize:12.5, color:'#f59e0b', textAlign:'center', margin:'4px 0 0'}}>⚠ Select a category to continue</p>
          )}
        </div>
      )}

      {step===STEP.VOICE&&(
        <div className="t-card">
          <div className="t-card-head">
            <div className="t-icon ti-green"><i className="ti ti-microphone" aria-hidden="true"/></div>
            <div><div className="t-ct">What should the email say?</div><div className="t-cs">To {extracted.name||extracted.email||'contact'}</div></div>
          </div>
          <button className={`t-btn ${recording?'t-btn-red':'t-btn-ghost'}`}
            onMouseDown={startRec} onMouseUp={stopRec} onTouchStart={startRec} onTouchEnd={stopRec} style={{userSelect:'none'}}>
            <i className={`ti ${recording?'ti-microphone-off':'ti-microphone'}`} aria-hidden="true"/>
            {recording?'Release to stop':'Hold to speak'}
          </button>
          {loading&&<div className="t-dot-row"><span className="t-dot t-dot-active"/><span>Transcribing…</span></div>}
          <textarea className="t-input" rows={3} placeholder="Or type your instruction here…"
            value={instruction} onChange={e=>setInstruction(e.target.value)} style={{marginTop:10,resize:'vertical',minHeight:80}}/>
          <button className="t-btn t-btn-primary" onClick={handleDraft} disabled={loading||!instruction.trim()}>
            {loading?'Drafting…':<><i className="ti ti-wand" aria-hidden="true"/> Draft email</>}
          </button>
          <button className="t-btn t-btn-ghost" onClick={()=>setStep(STEP.SCAN)}>← Back</button>
        </div>
      )}

      {step===STEP.DRAFT&&draft&&(
        <div className="t-card">
          <div className="t-card-head">
            <div className="t-icon ti-blue"><i className="ti ti-mail" aria-hidden="true"/></div>
            <div style={{flex:1}}>
              <div className="t-ct">Email draft</div>
              <div className="t-cs">{isSpeaking?'Reading aloud…':'Review and send'}</div>
            </div>
            <button onClick={isSpeaking?stop:()=>speak(`Subject: ${draft.subject}. ${draft.body}`.slice(0,600))}
              style={{background:'none',border:'1px solid #e5e5e4',borderRadius:8,padding:'5px 10px',fontSize:12,cursor:'pointer',color:'#6b7280',fontFamily:'inherit'}}>
              {isSpeaking?'Stop':'▶ Replay'}
            </button>
          </div>
          <div style={{marginBottom:10}}>
            <label style={{fontSize:11,fontWeight:600,color:'#6b7280',display:'block',marginBottom:4,textTransform:'uppercase',letterSpacing:'.3px'}}>Subject</label>
            <input className="t-input" value={draft.subject} onChange={e=>setDraft(d=>({...d,subject:e.target.value}))}/>
          </div>
          <div>
            <label style={{fontSize:11,fontWeight:600,color:'#6b7280',display:'block',marginBottom:4,textTransform:'uppercase',letterSpacing:'.3px'}}>Body</label>
            <textarea className="t-input" rows={7} value={draft.body} onChange={e=>setDraft(d=>({...d,body:e.target.value}))} style={{resize:'vertical'}}/>
          </div>
          <button className="t-btn t-btn-primary" onClick={handleSend} disabled={sending}>
            {sending?'Sending…':<><i className="ti ti-send" aria-hidden="true"/> Send email</>}
          </button>
          <button className="t-btn t-btn-ghost" onClick={()=>{stop();setStep(STEP.VOICE)}}>← Edit instruction</button>
        </div>
      )}

      {step===STEP.SENT&&(
        <div className="t-card">
          {sendResult?.method==='gmail'?(
            <div style={{textAlign:'center',padding:'24px 0'}}>
              <div style={{fontSize:44,marginBottom:12}}>✅</div>
              <div className="t-ct" style={{fontSize:16}}>Email sent!</div>
              <div className="t-cs" style={{marginTop:4}}>Delivered via Gmail</div>
            </div>
          ):(
            <>
              <div className="t-card-head">
                <div className="t-icon ti-amber"><i className="ti ti-info-circle" aria-hidden="true"/></div>
                <div><div className="t-ct">Gmail not connected yet</div><div className="t-cs">Use one of these to send</div></div>
              </div>
              <a href={sendResult?.mailto} className="t-btn t-btn-primary" style={{textDecoration:'none',display:'flex'}}>
                <i className="ti ti-mail" aria-hidden="true"/> Open in mail app
              </a>
              <button className="t-btn t-btn-ghost" onClick={()=>{navigator.clipboard.writeText(draft?.body||'');toast('Copied!','success')}}>
                <i className="ti ti-copy" aria-hidden="true"/> Copy email body
              </button>
            </>
          )}
          <button className="t-btn t-btn-ghost" style={{marginTop:12}} onClick={reset}>
            <i className="ti ti-refresh" aria-hidden="true"/> Scan another card
          </button>
        </div>
      )}
    </div>
  )
}

function toast(msg,type='info'){
  let el=document.getElementById('t-toast')
  if(!el){el=document.createElement('div');el.id='t-toast';document.body.appendChild(el)}
  el.textContent=msg
  el.className=type==='error'?'error':type==='success'?'success':''
  el.classList.add('show')
  clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),3000)
}
