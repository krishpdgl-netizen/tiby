import { useState, useRef } from 'react'

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''
const API_URL = import.meta.env.VITE_API_URL || 'https://tiby.onrender.com/api/v1'
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1i2g6CyilXM--qk35qHwydYkyokvd0L0oEjO7b8BNW6I'

export default function MeetingPage() {
  const [title, setTitle]           = useState('')
  const [mode, setMode]             = useState(null)
  const [result, setResult]         = useState(null)
  const [loading, setLoading]       = useState(false)
  const [status, setStatus]         = useState('')
  const [dot, setDot]               = useState('idle')
  const [noteBlob, setNoteBlob]     = useState(null)
  const [notePreview, setNotePreview] = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [recording, setRecording]   = useState(false)
  const [elapsed, setElapsed]       = useState(0)

  const videoRef  = useRef(); const streamRef = useRef()
  const mrRef     = useRef(); const chunksRef = useRef([])
  const timerRef  = useRef()

  function b64(blob) {
    return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(blob)})
  }
  function resize(canvas, max=1280) {
    return new Promise(resolve=>{
      const s=Math.min(max/canvas.width,max/canvas.height,1)
      const out=document.createElement('canvas')
      out.width=Math.round(canvas.width*s);out.height=Math.round(canvas.height*s)
      out.getContext('2d').drawImage(canvas,0,0,out.width,out.height)
      out.toBlob(resolve,'image/jpeg',0.82)
    })
  }
  function fmt(s){return`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}

  async function openCamera() {
    try {
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}})
      streamRef.current=stream;videoRef.current.srcObject=stream
      videoRef.current.style.display='block';setCameraOpen(true)
    } catch { toast('Camera access denied','error') }
  }

  async function snapPhoto() {
    const cv=document.createElement('canvas')
    cv.width=videoRef.current.videoWidth;cv.height=videoRef.current.videoHeight
    cv.getContext('2d').drawImage(videoRef.current,0,0)
    streamRef.current?.getTracks().forEach(t=>t.stop())
    videoRef.current.style.display='none';setCameraOpen(false)
    const blob=await resize(cv)
    setNoteBlob(blob);setNotePreview(URL.createObjectURL(blob))
  }

  async function processNotes() {
    if(!noteBlob)return
    setLoading(true);setDot('active');setStatus('Reading handwritten notes…')
    try {
      const enc=await b64(noteBlob)
      const res=await fetch(APPS_SCRIPT_URL,{method:'POST',body:JSON.stringify({action:'scan-notes',image_base64:enc,image_mime:'image/jpeg',meeting_title:title||'Meeting'})})
      const data=await res.json()
      if(data.status==='success'){setResult(data);setDot('done');setStatus('Minutes ready')}
      else throw new Error(data.message||'Extraction failed')
    } catch(e){setDot('warn');setStatus('Could not process — try again');toast(e.message,'error')}
    finally{setLoading(false)}
  }

  async function startRecording() {
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true})
      chunksRef.current=[]
      const mr=new MediaRecorder(stream,{mimeType:'audio/webm'});mrRef.current=mr
      mr.ondataavailable=e=>{if(e.data.size>0)chunksRef.current.push(e.data)}
      mr.start(1000);setRecording(true);setElapsed(0)
      setDot('active');setStatus('Recording…')
      timerRef.current=setInterval(()=>setElapsed(s=>s+1),1000)
    } catch{toast('Microphone access denied','error')}
  }

  async function stopRecording() {
    clearInterval(timerRef.current);setRecording(false)
    setLoading(true);setDot('active');setStatus('Stopping…')
    await new Promise(resolve=>{mrRef.current.onstop=resolve;mrRef.current.stream?.getTracks().forEach(t=>t.stop());mrRef.current.stop()})
    const blob=new Blob(chunksRef.current,{type:'audio/webm'})
    try {
      setStatus('Transcribing audio…')
      const form=new FormData();form.append('file',blob,'recording.webm')
      const sttRes=await fetch(`${API_URL}/voice/transcribe`,{method:'POST',body:form})
      const sttData=await sttRes.json()
      const transcript=sttData.transcript||''
      if(!transcript)throw new Error('No speech detected')
      setStatus('Generating minutes…')
      const momRes=await fetch(APPS_SCRIPT_URL,{method:'POST',body:JSON.stringify({action:'generate-mom',transcript,meeting_title:title||'Meeting'})})
      const momData=await momRes.json()
      if(momData.status!=='success')throw new Error(momData.message||'MOM generation failed')
      setResult({...momData,transcript});setDot('done');setStatus('Minutes ready')
    } catch(e){setDot('warn');setStatus('Processing failed');toast(e.message,'error')}
    finally{setLoading(false)}
  }

  function reset() {
    setMode(null);setResult(null);setTitle('')
    setStatus('');setDot('idle');setNoteBlob(null);setNotePreview(null);setCameraOpen(false)
    setRecording(false);setElapsed(0)
    streamRef.current?.getTracks().forEach(t=>t.stop())
    if(videoRef.current){videoRef.current.style.display='none';videoRef.current.srcObject=null}
    clearInterval(timerRef.current)
  }

  // ── RESULT ──────────────────────────────────────────────────────────────────
  if(result) return (
    <div className="t-content" style={{paddingTop:16}}>
      <div className="t-card success">
        <div className="t-card-head">
          <div className="t-icon ti-green"><i className="ti ti-check" aria-hidden="true"/></div>
          <div><div className="t-ct">{title||'Meeting'}</div><div className="t-cs">Minutes of meeting ready</div></div>
        </div>

        {result.summary && (
          <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:10,padding:12,marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'#065f46',textTransform:'uppercase',letterSpacing:'.4px',marginBottom:6}}>Summary</div>
            <p style={{fontSize:13.5,color:'#1a1a1a',lineHeight:1.6,margin:0}}>{result.summary}</p>
          </div>
        )}

        {result.action_items?.length>0 && (
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'#1e40af',textTransform:'uppercase',letterSpacing:'.4px',marginBottom:10}}>Action items</div>
            {result.action_items.map((item,i)=>(
              <div key={i} style={{display:'flex',gap:9,marginBottom:10,alignItems:'flex-start'}}>
                <div style={{width:22,height:22,borderRadius:'50%',background:'#dbeafe',border:'1.5px solid #93c5fd',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,color:'#1e40af',flexShrink:0,marginTop:1}}>{i+1}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13.5,color:'#1a1a1a',lineHeight:1.5}}>{item.task}</div>
                  <div style={{fontSize:12,color:'#6b7280',marginTop:2,display:'flex',gap:12}}>
                    {item.owner&&item.owner!=='TBD'&&<span>👤 {item.owner}</span>}
                    {item.due&&item.due!=='TBD'&&<span>📅 {item.due}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {result.mom && (
          <details style={{marginBottom:12}}>
            <summary style={{fontSize:13,fontWeight:600,color:'#6b7280',cursor:'pointer',userSelect:'none',listStyle:'none',display:'flex',alignItems:'center',gap:6}}>
              <i className="ti ti-file-text" style={{fontSize:16}} aria-hidden="true"/> Full minutes of meeting
            </summary>
            <div style={{fontSize:13,color:'#1a1a1a',lineHeight:1.7,whiteSpace:'pre-wrap',background:'#f9f9f8',borderRadius:9,padding:12,marginTop:8}}>
              {result.mom}
            </div>
          </details>
        )}

        <a href={`mailto:?subject=${encodeURIComponent('MOM: '+(title||'Meeting'))}&body=${encodeURIComponent(result.mom||result.summary||'')}`}
          className="t-btn t-btn-primary" style={{textDecoration:'none',display:'flex'}}>
          <i className="ti ti-mail" aria-hidden="true"/> Email MOM to myself
        </a>
        <a href={SHEET_URL} target="_blank" rel="noreferrer" className="t-btn t-btn-ghost" style={{textDecoration:'none',display:'flex'}}>
          <i className="ti ti-external-link" aria-hidden="true"/> View in Sheets
        </a>
        <button className="t-btn t-btn-ghost" onClick={reset}>
          <i className="ti ti-plus" aria-hidden="true"/> New meeting
        </button>
      </div>
    </div>
  )

  // ── MAIN ────────────────────────────────────────────────────────────────────
  return (
    <div className="t-content" style={{paddingTop:16}}>

      {/* Title */}
      <div className="t-card">
        <div className="t-card-head">
          <div className="t-icon ti-gray"><i className="ti ti-calendar" aria-hidden="true"/></div>
          <div><div className="t-ct">New meeting</div><div className="t-cs">Enter title then choose an option</div></div>
        </div>
        <input className="t-input" placeholder="Meeting title — e.g. Client call with Rahul"
          value={title} onChange={e=>setTitle(e.target.value)} disabled={loading||recording} />
      </div>

      {/* ── NOTES ── */}
      <div className={`t-card ${mode==='notes'?'accent':''}`}>
        <div className="t-card-head">
          <div className="t-icon ti-amber"><i className="ti ti-pencil" aria-hidden="true"/></div>
          <div><div className="t-ct">Scan handwritten notes</div><div className="t-cs">Photo of notes → AI makes MOM + action items</div></div>
        </div>

        {mode!=='notes' ? (
          <button className="t-btn t-btn-amber" onClick={()=>{
            if(!title.trim())return toast('Enter a meeting title first','error')
            setMode('notes');setTimeout(()=>openCamera(),50)
          }}>
            <i className="ti ti-pencil" aria-hidden="true"/> Scan notes
          </button>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted style={{display:'none',width:'100%',borderRadius:11,marginBottom:10,background:'#000',aspectRatio:'4/3',objectFit:'cover'}}/>
            {notePreview&&<img src={notePreview} alt="Notes" style={{width:'100%',borderRadius:11,marginBottom:10,aspectRatio:'4/3',objectFit:'cover'}}/>}

            {!cameraOpen&&!noteBlob&&!loading&&(
              <button className="t-btn t-btn-amber" onClick={openCamera}>
                <i className="ti ti-camera" aria-hidden="true"/> Open camera
              </button>
            )}
            {cameraOpen&&(
              <button className="t-btn t-btn-green" onClick={snapPhoto}>
                <i className="ti ti-camera-selfie" aria-hidden="true"/> Snap photo
              </button>
            )}
            {noteBlob&&!loading&&(
              <div style={{display:'flex',gap:8}}>
                <button className="t-btn t-btn-ghost" style={{flex:1}} onClick={()=>{setNoteBlob(null);setNotePreview(null);openCamera()}}>
                  <i className="ti ti-refresh" aria-hidden="true"/> Retake
                </button>
                <button className="t-btn t-btn-primary" style={{flex:2,marginTop:0}} onClick={processNotes}>
                  <i className="ti ti-wand" aria-hidden="true"/> Process notes
                </button>
              </div>
            )}
            {loading&&<div className="t-dot-row"><span className="t-dot t-dot-active"/><span>{status}</span></div>}
            {dot==='warn'&&!loading&&<div className="t-dot-row"><span className="t-dot t-dot-warn"/><span>{status}</span></div>}
          </>
        )}
      </div>

      {/* ── RECORD ── */}
      <div className={`t-card ${mode==='record'?'danger':''}`}>
        <div className="t-card-head">
          <div className="t-icon ti-red"><i className="ti ti-microphone" aria-hidden="true"/></div>
          <div><div className="t-ct">Record meeting</div><div className="t-cs">Live audio → Deepgram STT → AI makes MOM</div></div>
        </div>

        {mode!=='record' ? (
          <button className="t-btn t-btn-primary" onClick={()=>{
            if(!title.trim())return toast('Enter a meeting title first','error')
            setMode('record');setTimeout(()=>startRecording(),50)
          }}>
            <i className="ti ti-microphone" aria-hidden="true"/> Start recording
          </button>
        ) : (
          <>
            {recording&&(
              <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:11,padding:'14px 16px',marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                  <div style={{width:9,height:9,borderRadius:'50%',background:'#ef4444',animation:'tdot 1s infinite'}}/>
                  <span className="t-timer">{fmt(elapsed)}</span>
                  <span style={{fontSize:13,color:'#6b7280'}}>Recording…</span>
                </div>
                <button className="t-btn t-btn-red" onClick={stopRecording}>
                  <i className="ti ti-square" aria-hidden="true"/> Stop and process
                </button>
              </div>
            )}
            {!recording&&!loading&&(
              <button className="t-btn t-btn-red" onClick={startRecording}>
                <i className="ti ti-circle" aria-hidden="true"/> Start recording
              </button>
            )}
            {loading&&!recording&&<div className="t-dot-row"><span className="t-dot t-dot-active"/><span>{status}</span></div>}
            {dot==='warn'&&!loading&&!recording&&<div className="t-dot-row"><span className="t-dot t-dot-warn"/><span>{status}</span></div>}
          </>
        )}
      </div>

      {/* Past meetings link */}
      <a href={`${SHEET_URL}/edit#gid=0`} target="_blank" rel="noreferrer"
        className="t-btn t-btn-ghost" style={{textDecoration:'none',display:'flex'}}>
        <i className="ti ti-external-link" aria-hidden="true"/> View past meetings in Sheets
      </a>

      <style>{`@keyframes tdot{50%{opacity:.3}}`}</style>
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
