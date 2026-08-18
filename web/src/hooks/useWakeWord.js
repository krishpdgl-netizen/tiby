/**
 * useWakeWord — detects "Hey Tiby" using the Web Speech API continuous recognition.
 *
 * How it works:
 *  - Runs a continuous SpeechRecognition session in the background (low battery impact
 *    because the browser's native VAD only wakes the CPU when speech is detected).
 *  - Every transcript fragment is checked for the wake phrase.
 *  - On match: calls onWake(), briefly flashes the UI, then hands off mic to the caller.
 *
 * Browser support: Chrome, Edge, Safari 17+.
 * Firefox: no SpeechRecognition — falls back gracefully (isSupported = false).
 *
 * Background tab behaviour:
 *  - Chrome pauses continuous recognition in background tabs after ~60s (security policy).
 *  - We auto-restart on the `end` event so it recovers immediately when the tab is
 *    foregrounded again.
 *  - For true background wake (screen off, app minimised), a native app or a WebAssembly
 *    model (e.g. Picovoice Porcupine) is required — see NOTES below.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

const WAKE_PHRASES = ['hey tiby', 'hey tib', 'tiby', 'hey tibi'] // fuzzy aliases

export function useWakeWord({ onWake, enabled = true }) {
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const [wakeDetected, setWakeDetected] = useState(false)
  const recognitionRef = useRef(null)
  const restartTimerRef = useRef(null)
  const activeRef = useRef(false)

  // ── Bootstrap recognition instance ──────────────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      console.warn('[Tiby] SpeechRecognition not supported in this browser.')
      setIsSupported(false)
      return
    }
    setIsSupported(true)

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true   // get partial results for lower latency
    recognition.maxAlternatives = 3
    recognition.lang = 'en-US'

    recognition.onstart = () => setIsListening(true)
    recognition.onend = () => {
      setIsListening(false)
      // Auto-restart if we're supposed to be active
      if (activeRef.current) {
        restartTimerRef.current = setTimeout(() => {
          try { recognition.start() } catch {}
        }, 300)
      }
    }
    recognition.onerror = (e) => {
      // 'no-speech' and 'audio-capture' are normal — just restart
      if (['no-speech', 'audio-capture', 'network'].includes(e.error)) return
      console.warn('[Tiby] SpeechRecognition error:', e.error)
    }
    recognition.onresult = (e) => {
      // Scan every alternative in every result for the wake phrase
      for (let i = e.resultIndex; i < e.results.length; i++) {
        for (let j = 0; j < e.results[i].length; j++) {
          const text = e.results[i][j].transcript.toLowerCase().trim()
          if (WAKE_PHRASES.some((p) => text.includes(p))) {
            handleWake()
            return
          }
        }
      }
    }

    recognitionRef.current = recognition
    return () => {
      activeRef.current = false
      clearTimeout(restartTimerRef.current)
      try { recognition.abort() } catch {}
    }
  }, [])

  // ── Start / stop based on `enabled` prop ────────────────────
  useEffect(() => {
    const recognition = recognitionRef.current
    if (!recognition) return

    if (enabled) {
      activeRef.current = true
      try { recognition.start() } catch {}
    } else {
      activeRef.current = false
      clearTimeout(restartTimerRef.current)
      try { recognition.stop() } catch {}
    }
  }, [enabled])

  // ── Wake handler ─────────────────────────────────────────────
  const handleWake = useCallback(() => {
    const recognition = recognitionRef.current
    // Stop wake word listening while the main flow takes the mic
    activeRef.current = false
    clearTimeout(restartTimerRef.current)
    try { recognition?.stop() } catch {}

    // Visual feedback
    setWakeDetected(true)
    setTimeout(() => setWakeDetected(false), 2000)

    // Haptic feedback on mobile
    if (navigator.vibrate) navigator.vibrate([100, 50, 100])

    // Notify parent
    onWake?.()

    // Resume wake word detection after 8 seconds (gives time for command)
    setTimeout(() => {
      activeRef.current = true
      try { recognition?.start() } catch {}
    }, 8000)
  }, [onWake])

  // ── Manual trigger (button) ──────────────────────────────────
  const triggerManually = useCallback(() => handleWake(), [handleWake])

  return { isListening, isSupported, wakeDetected, triggerManually }
}

/*
 * NOTES — getting true background wake word detection:
 *
 * Option A (best for PWA): Picovoice Porcupine Web SDK
 *   - Runs a tiny WASM model entirely in the browser, no server needed
 *   - Custom wake word "Hey Tiby" can be trained at console.picovoice.ai (free tier)
 *   - Works in background tabs via a SharedWorker / AudioWorklet
 *   - npm install @picovoice/porcupine-web
 *   - Drop-in replacement for the SpeechRecognition approach above
 *   - https://picovoice.ai/docs/quick-start/porcupine-web/
 *
 * Option B: Snowboy (deprecated but WASM port exists)
 *
 * Option C: React Native app — then use @picovoice/porcupine-react-native
 *   which works even when the screen is off.
 *
 * For Phase 1 the SpeechRecognition approach is good enough for demos
 * and active-tab use. Swap in Porcupine for Phase 2.
 */
