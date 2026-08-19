import { useEffect, useRef, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'https://tiby.onrender.com/api/v1'

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4']
  return types.find(t => MediaRecorder.isTypeSupported(t)) || ''
}

export default function WakeWordOverlay({ onCommand, onDismiss }) {
  const [phase, setPhase]           = useState('wake')
  const [transcript, setTranscript] = useState('')
  const mrRef      = useRef()
  const chunksRef  = useRef([])
  const timerRef   = useRef()
  const streamRef  = useRef()

  useEffect(() => {
    const t = setTimeout(() => startListening(), 600)
    return () => {
      clearTimeout(t)
      clearTimeout(timerRef.current)
      try { mrRef.current?.stop() } catch {}
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  async function startListening() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const mimeType = getSupportedMimeType()
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      mrRef.current = mr
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        await processAudio(mimeType)
      }
      mr.start(200)
      setPhase('listening')
      timerRef.current = setTimeout(() => stopListening(), 8000)
    } catch { onDismiss?.() }
  }

  function stopListening() {
    clearTimeout(timerRef.current)
    try { mrRef.current?.stop() } catch {}
    setPhase('processing')
  }

  async function processAudio(mimeType) {
    const type = mimeType || 'audio/webm'
    const blob = new Blob(chunksRef.current, { type })
    if (blob.size < 500) { onDismiss?.(); return }
    try {
      const form = new FormData()
      form.append('file', blob, 'voice.webm')
      const res  = await fetch(`${API_URL}/voice/transcribe`, { method: 'POST', body: form })
      const data = await res.json()
      const text = data.transcript?.trim()
      if (text) {
        setTranscript(text); setPhase('done')
        setTimeout(() => onCommand?.(text), 800)
      } else { onDismiss?.() }
    } catch { onDismiss?.() }
  }

  return (
    <div style={{ position:'fixed',inset:0,zIndex:50,display:'flex',alignItems:'flex-end',justifyContent:'center',paddingBottom:96,pointerEvents:'none' }}>
      <div style={{ position:'absolute',inset:0,background:'rgba(0,0,0,0.3)',backdropFilter:'blur(4px)',pointerEvents:'auto' }} onClick={onDismiss}/>
      <div style={{ position:'relative',pointerEvents:'auto',width:'100%',maxWidth:360,margin:'0 16px',background:'#fff',borderRadius:24,boxShadow:'0 20px 60px rgba(0,0,0,0.15)',padding:24,display:'flex',flexDirection:'column',alignItems:'center',gap:16 }}>
        <button onClick={onDismiss} style={{ position:'absolute',top:12,right:12,background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:18 }}>✕</button>

        {/* Orb */}
        <div style={{ position:'relative',display:'flex',alignItems:'center',justifyContent:'center' }}>
          {(phase==='wake'||phase==='listening') && <>
            <span style={{ position:'absolute',width:96,height:96,borderRadius:'50%',background:'rgba(99,102,241,0.15)',animation:'tping 1s infinite' }}/>
            <span style={{ position:'absolute',width:64,height:64,borderRadius:'50%',background:'rgba(99,102,241,0.2)',animation:'tping 1s infinite',animationDelay:'.15s' }}/>
          </>}
          <div style={{ width:56,height:56,borderRadius:'50%',background:phase==='done'?'#10b981':'#4f46e5',display:'flex',alignItems:'center',justifyContent:'center',transition:'background .3s' }}>
            <span style={{ fontSize:24 }}>🎤</span>
          </div>
        </div>

        {/* Status */}
        <div style={{ textAlign:'center' }}>
          {phase==='wake'       && <><p style={{ fontWeight:600,color:'#1a1a1a',margin:0 }}>Hey Tiby!</p><p style={{ fontSize:13,color:'#9ca3af',margin:0 }}>Starting mic…</p></>}
          {phase==='listening'  && <><p style={{ fontWeight:600,color:'#1a1a1a',margin:0 }}>Listening…</p><p style={{ fontSize:13,color:'#9ca3af',margin:0 }}>Speak your command</p><button onClick={stopListening} style={{ marginTop:8,fontSize:12,color:'#4f46e5',background:'none',border:'none',cursor:'pointer' }}>Done speaking</button></>}
          {phase==='processing' && <><p style={{ fontWeight:600,color:'#1a1a1a',margin:0 }}>Got it…</p><p style={{ fontSize:13,color:'#9ca3af',margin:0 }}>Processing</p></>}
          {phase==='done'&&transcript && <><p style={{ fontWeight:600,color:'#1a1a1a',margin:0 }}>"{transcript}"</p><p style={{ fontSize:13,color:'#10b981',margin:'4px 0 0' }}>On it!</p></>}
        </div>

        {/* Wave */}
        {phase==='listening' && (
          <div style={{ display:'flex',alignItems:'center',gap:3,height:24 }}>
            {[...Array(8)].map((_,i) => (
              <div key={i} style={{ width:3,borderRadius:2,background:'#4f46e5',animation:`twave .8s ease-in-out infinite`,animationDelay:`${i*.1}s`,height:`${8+Math.sin(i)*6}px` }}/>
            ))}
          </div>
        )}
      </div>
      <style>{`@keyframes tping{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.15);opacity:.2}}@keyframes twave{0%,100%{transform:scaleY(.4)}50%{transform:scaleY(1.4)}}`}</style>
    </div>
  )
}
