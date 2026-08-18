/**
 * useSpeech — browser-native text-to-speech via speechSynthesis API.
 * No API key, no cost, works on all modern browsers including mobile Safari.
 *
 * Usage:
 *   const { speak, stop, isSpeaking } = useSpeech()
 *   speak("Hello, here is your email draft...")
 */
import { useState, useCallback, useRef } from 'react'

export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const utteranceRef = useRef(null)

  const speak = useCallback((text, opts = {}) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()   // stop anything currently playing

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = opts.rate || 0.95
    utterance.pitch = opts.pitch || 1
    utterance.volume = opts.volume || 1
    utterance.lang = opts.lang || 'en-US'

    // Pick a natural-sounding voice if available
    const voices = window.speechSynthesis.getVoices()
    const preferred = voices.find(v =>
      v.name.includes('Samantha') ||   // macOS/iOS
      v.name.includes('Google UK English Female') ||
      v.name.includes('Microsoft Aria') ||
      (v.lang === 'en-US' && v.localService)
    )
    if (preferred) utterance.voice = preferred

    utterance.onstart = () => setIsSpeaking(true)
    utterance.onend = () => { setIsSpeaking(false); opts.onEnd?.() }
    utterance.onerror = () => setIsSpeaking(false)

    utteranceRef.current = utterance
    window.speechSynthesis.speak(utterance)
  }, [])

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel()
    setIsSpeaking(false)
  }, [])

  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  return { speak, stop, isSpeaking, isSupported }
}
