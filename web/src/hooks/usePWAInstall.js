/**
 * usePWAInstall
 * Captures the beforeinstallprompt event so we can show
 * our own "Install Tiby" button at the right moment,
 * instead of relying on Chrome's default banner.
 */

import { useState, useEffect } from 'react'

export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)

  useEffect(() => {
    // Check if already running as installed PWA
    const mq = window.matchMedia('(display-mode: standalone)')
    setIsInstalled(mq.matches || window.navigator.standalone === true)

    const handler = (e) => {
      e.preventDefault()         // prevent auto-prompt
      setInstallPrompt(e)        // save for later
    }
    window.addEventListener('beforeinstallprompt', handler)

    const installedHandler = () => setIsInstalled(true)
    window.addEventListener('appinstalled', installedHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  const install = async () => {
    if (!installPrompt) return false
    setIsInstalling(true)
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    setInstallPrompt(null)
    setIsInstalling(false)
    if (outcome === 'accepted') setIsInstalled(true)
    return outcome === 'accepted'
  }

  return { canInstall: !!installPrompt, isInstalled, isInstalling, install }
}
