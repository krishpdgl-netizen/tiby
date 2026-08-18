/**
 * useCommandRouter
 * Takes a spoken command string and routes it to the right action/page.
 *
 * Examples:
 *  "scan a card"          → navigate to /
 *  "start a meeting"      → navigate to /meetings and auto-start
 *  "send email to Rahul"  → navigate to contacts, pre-fill
 *  "show my contacts"     → navigate to /contacts
 *  "open settings"        → navigate to /settings
 */

import { useNavigate } from 'react-router-dom'
import { useCallback } from 'react'
import toast from 'react-hot-toast'

const ROUTES = [
  { patterns: ['scan', 'card', 'business card', 'scan card'], path: '/' },
  { patterns: ['meeting', 'record', 'start meeting', 'new meeting'], path: '/meetings', action: 'start' },
  { patterns: ['contact', 'contacts', 'show contacts'], path: '/contacts' },
  { patterns: ['setting', 'settings', 'gmail', 'connect'], path: '/settings' },
  { patterns: ['email', 'send email', 'draft'], path: '/' },    // card scan → email flow
]

export function useCommandRouter() {
  const navigate = useNavigate()

  const route = useCallback((transcript) => {
    const lower = transcript.toLowerCase()

    // Remove the wake phrase itself from the command
    const clean = lower
      .replace(/hey tiby[,.]?\s*/gi, '')
      .replace(/tiby[,.]?\s*/gi, '')
      .trim()

    if (!clean) {
      toast('Say a command like "scan a card" or "start a meeting"', { icon: '💬' })
      return null
    }

    for (const route of ROUTES) {
      if (route.patterns.some((p) => clean.includes(p))) {
        navigate(route.path, { state: { autoAction: route.action, voiceCommand: clean } })
        return route
      }
    }

    // Fallback — go home
    toast(`Command not recognised: "${clean}"`, { icon: '🤔' })
    navigate('/', { state: { voiceCommand: clean } })
    return null
  }, [navigate])

  return { route }
}
