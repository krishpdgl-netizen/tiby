/**
 * WakeWordOverlay
 * Shown when "Hey Tiby" is detected — pulsing ring + listening state.
 * Dismisses automatically after the user finishes speaking or clicks away.
 */
import { useEffect, useRef, useState } from 'react'
import { Mic, X } from 'lucide-react'
import { transcribeVoice } from '../services/api'

export default function WakeWordOverlay({ onCommand, onDismiss }) {
  const [phase, setPhase] = useState('wake')   // wake → listening → processing → done
  const [transcript, setTranscript] = useState('')
  const mediaRecorderRef = useRef()
  const chunksRef = useRef([])
  const silenceTimerRef = useRef()

  useEffect(() => {
    // Auto-start mic capture after brief wake animation
    const t = setTimeout(() => startListening(), 600)
    return () => clearTimeout(t)
  }, [])

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mr

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        await processAudio()
      }

      mr.start(200) // collect every 200ms
      setPhase('listening')

      // Auto-stop after 8s silence timeout
      silenceTimerRef.current = setTimeout(() => stopListening(), 8000)
    } catch {
      onDismiss?.()
    }
  }

  const stopListening = () => {
    clearTimeout(silenceTimerRef.current)
    try { mediaRecorderRef.current?.stop() } catch {}
    setPhase('processing')
  }

  const processAudio = async () => {
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    if (blob.size < 1000) { onDismiss?.(); return }   // too short, no real speech

    try {
      const { data } = await transcribeVoice(blob)
      const text = data.transcript?.trim()
      if (text) {
        setTranscript(text)
        setPhase('done')
        setTimeout(() => onCommand?.(text), 800)
      } else {
        onDismiss?.()
      }
    } catch {
      onDismiss?.()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pb-24 pointer-events-none">
      {/* Backdrop — dim everything */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-auto"
        onClick={onDismiss}
      />

      {/* Main card */}
      <div className="relative pointer-events-auto w-full max-w-sm mx-4 bg-white rounded-3xl shadow-2xl p-6 flex flex-col items-center gap-4">

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="absolute top-3 right-3 p-1.5 rounded-full text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>

        {/* Animated orb */}
        <div className="relative flex items-center justify-center">
          {/* Outer pulse rings */}
          {(phase === 'wake' || phase === 'listening') && (
            <>
              <span className="absolute w-24 h-24 rounded-full bg-indigo-400/20 animate-ping" />
              <span className="absolute w-16 h-16 rounded-full bg-indigo-400/30 animate-ping [animation-delay:150ms]" />
            </>
          )}
          {/* Core orb */}
          <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 ${
            phase === 'wake'        ? 'bg-indigo-600 scale-110' :
            phase === 'listening'   ? 'bg-indigo-600 animate-pulse' :
            phase === 'processing'  ? 'bg-indigo-400' :
            'bg-green-500'
          }`}>
            <Mic className="text-white" size={24} />
          </div>
        </div>

        {/* Status text */}
        <div className="text-center">
          {phase === 'wake' && (
            <>
              <p className="font-semibold text-gray-900">Hey Tiby!</p>
              <p className="text-sm text-gray-400">Starting mic…</p>
            </>
          )}
          {phase === 'listening' && (
            <>
              <p className="font-semibold text-gray-900">Listening…</p>
              <p className="text-sm text-gray-400">Speak your command</p>
              <button
                onClick={stopListening}
                className="mt-3 text-xs text-indigo-500 hover:underline"
              >
                Done speaking
              </button>
            </>
          )}
          {phase === 'processing' && (
            <>
              <p className="font-semibold text-gray-900">Got it…</p>
              <p className="text-sm text-gray-400">Processing your command</p>
            </>
          )}
          {phase === 'done' && transcript && (
            <>
              <p className="font-semibold text-gray-900">"{transcript}"</p>
              <p className="text-sm text-green-500 mt-1">On it!</p>
            </>
          )}
        </div>

        {/* Audio wave visualiser (CSS only) */}
        {phase === 'listening' && (
          <div className="flex items-center gap-1 h-6">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="w-1 rounded-full bg-indigo-400"
                style={{
                  animation: `soundWave 0.8s ease-in-out infinite`,
                  animationDelay: `${i * 0.1}s`,
                  height: `${8 + Math.sin(i) * 8}px`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes soundWave {
          0%, 100% { transform: scaleY(0.4); }
          50%       { transform: scaleY(1.4); }
        }
      `}</style>
    </div>
  )
}
