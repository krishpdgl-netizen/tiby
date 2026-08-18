import { useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { Toaster, toast } from 'react-hot-toast'
import { Camera, Mic, Users, Settings, Download } from 'lucide-react'

import CardScannerPage from './pages/CardScannerPage'
import MeetingPage from './pages/MeetingPage'
import WakeWordOverlay from './components/WakeWordOverlay'
import { useWakeWord } from './hooks/useWakeWord'
import { useCommandRouter } from './hooks/useCommandRouter'
import { usePWAInstall } from './hooks/usePWAInstall'

const NAV = [
  { to: '/', icon: Camera, label: 'Scan Card' },
  { to: '/meetings', icon: Mic, label: 'Meetings' },
  { to: '/contacts', icon: Users, label: 'Contacts' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

/* Inner component has access to useNavigate (must be inside BrowserRouter) */
function AppInner() {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const { route } = useCommandRouter()
  const { canInstall, isInstalled, install } = usePWAInstall()

  const handleWake = useCallback(() => {
    setOverlayOpen(true)
  }, [])

  const handleCommand = useCallback((transcript) => {
    setOverlayOpen(false)
    route(transcript)
  }, [route])

  const { isListening, isSupported, wakeDetected, triggerManually } = useWakeWord({
    onWake: handleWake,
    enabled: !overlayOpen,   // pause wake detection while overlay is open
  })

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
          <span className="text-white text-xs font-bold">T</span>
        </div>
        <span className="font-semibold text-gray-900">Tiby</span>

        <div className="ml-auto flex items-center gap-2">
          {/* Wake word status dot */}
          {isSupported && (
            <div className="flex items-center gap-1.5" title="Wake word active — say 'Hey Tiby'">
              <div className={`w-2 h-2 rounded-full transition-colors ${
                wakeDetected  ? 'bg-green-400 animate-ping' :
                isListening   ? 'bg-indigo-400 animate-pulse' :
                                'bg-gray-300'
              }`} />
              <span className="text-xs text-gray-400 hidden sm:inline">
                {wakeDetected ? 'Woke!' : isListening ? 'Listening' : 'Hey Tiby'}
              </span>
            </div>
          )}

          {/* Mic button — manual trigger */}
          <button
            onClick={() => setOverlayOpen(true)}
            className={`p-2 rounded-xl transition-colors ${
              overlayOpen ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50'
            }`}
            title="Tap to speak"
          >
            <Mic size={18} />
          </button>

          {/* Install button */}
          {canInstall && !isInstalled && (
            <button
              onClick={install}
              className="flex items-center gap-1.5 text-xs bg-indigo-50 text-indigo-600 px-2.5 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors"
            >
              <Download size={13} />
              Install
            </button>
          )}
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 pb-20 overflow-y-auto">
        <Routes>
          <Route path="/" element={<CardScannerPage />} />
          <Route path="/meetings" element={<MeetingPage />} />
          <Route path="/contacts" element={<div className="p-4 text-gray-500">Contacts — coming soon</div>} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex safe-bottom">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-3 gap-1 text-xs transition-colors ${
                isActive ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'
              }`
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Wake word overlay */}
      {overlayOpen && (
        <WakeWordOverlay
          onCommand={handleCommand}
          onDismiss={() => setOverlayOpen(false)}
        />
      )}

      {/* Toast notifications */}
      <Toaster position="top-center" toastOptions={{ duration: 3000 }} />
    </div>
  )
}

function SettingsPage() {
  const connectGmail = async () => {
    const { data } = await import('./services/api').then((m) => m.getGmailAuthUrl())
    window.location.href = data.auth_url
  }
  const params = new URLSearchParams(window.location.search)
  const gmailConnected = params.get('gmail') === 'connected'

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="card space-y-3">
        <h2 className="font-medium">Gmail</h2>
        {gmailConnected ? (
          <div className="flex items-center gap-2 text-green-600 text-sm">
            <div className="w-2 h-2 bg-green-500 rounded-full" />Connected
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500">Connect Gmail so Tiby can send emails on your behalf.</p>
            <button onClick={connectGmail} className="btn-primary">Connect Gmail</button>
          </>
        )}
      </div>
      <div className="card space-y-2">
        <h2 className="font-medium">Wake Word</h2>
        <p className="text-sm text-gray-500">
          Say <strong>"Hey Tiby"</strong> anywhere in the app to activate the assistant.
          The mic indicator in the header shows when wake detection is active.
        </p>
        <p className="text-xs text-gray-400">
          Wake word detection requires microphone permission and works best in Chrome / Edge / Safari 17+.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  )
}
