import { useState, useEffect, useCallback, useRef } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'

import LoginPage       from './pages/LoginPage'
import HomePage        from './pages/HomePage'
import CardScannerPage from './pages/CardScannerPage'
import MeetingPage     from './pages/MeetingPage'
import ContactsPage    from './pages/ContactsPage'
import AnalyticsPage   from './pages/AnalyticsPage'
import SettingsPage    from './pages/SettingsPage'
import SearchPage      from './pages/SearchPage'
import WakeWordOverlay from './components/WakeWordOverlay'
import { useWakeWord }   from './hooks/useWakeWord'
import { usePWAInstall } from './hooks/usePWAInstall'
import { supabase, signOut } from './services/supabase'

const NAV = [
  { to: '/home',      icon: 'ti-home',       label: 'Home' },
  { to: '/scan',      icon: 'ti-id',         label: 'Scan' },
  { to: '/meetings',  icon: 'ti-microphone', label: 'Meetings' },
  { to: '/contacts',  icon: 'ti-users',      label: 'Contacts' },
  { to: '/analytics', icon: 'ti-chart-bar',  label: 'Tasks' },
  { to: '/search',    icon: 'ti-search',     label: 'Search' },
  { to: '/settings',  icon: 'ti-settings',   label: 'Settings' },
]


const PAGE_META = {
  '/home':      { icon: 'ti-home',       bg: '#f5f5f4', color: '#6b7280', title: 'Home',        sub: 'Ask Tiby anything' },
  '/scan':      { icon: 'ti-id',         bg: '#fef3c7', color: '#92400e', title: 'Card scanner', sub: 'Scan → extract → email' },
  '/meetings':  { icon: 'ti-microphone', bg: '#fee2e2', color: '#991b1b', title: 'Meetings',     sub: 'Record or scan notes' },
  '/contacts':  { icon: 'ti-users',      bg: '#dbeafe', color: '#1e40af', title: 'Contacts',     sub: 'Your saved contacts' },
  '/analytics': { icon: 'ti-chart-bar',  bg: '#ede9fe', color: '#5b21b6', title: 'Dashboard',    sub: 'Tasks + analytics' },
  '/settings':  { icon: 'ti-settings',   bg: '#f5f5f4', color: '#6b7280', title: 'Settings',     sub: 'Account and preferences' },
  '/search':    { icon: 'ti-search',     bg: '#f0fdf4', color: '#065f46', title: 'Search',       sub: 'Find anything in Tiby' },
}

const HOME_PATHS = new Set(['/', '/home'])

function AppInner({ user }) {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const { canInstall, isInstalled, install } = usePWAInstall()
  const navigate  = useNavigate()
  const location  = useLocation()
  const lastBackRef = useRef(0)

  const handleWake    = useCallback(() => setOverlayOpen(true), [])
  const handleCommand = useCallback((t) => {
    setOverlayOpen(false)
    navigate('/home', { state: { voiceCommand: t } })
  }, [navigate])

  useWakeWord({ onWake: handleWake, enabled: false })

  // ── Double-back-to-exit on Android PWA ───────────────────────────────────
  useEffect(() => {
    function onPopState() {
      const now = Date.now()
      const isHome = HOME_PATHS.has(location.pathname)

      if (isHome) {
        // On home screen — double press exits
        if (now - lastBackRef.current < 2000) {
          // Second press within 2s — close the app
          window.history.pushState(null, '', window.location.href)
          if (navigator.app?.exitApp) {
            navigator.app.exitApp()
          } else {
            // PWA fallback — move app to background on Android
            window.close()
          }
        } else {
          // First press — show toast hint and push state to catch next press
          lastBackRef.current = now
          window.history.pushState(null, '', window.location.href)
          showExitToast()
        }
      } else {
        // Not on home — go home instead of back
        navigate('/home', { replace: true })
      }
    }

    // Push a state so we can catch popstate
    window.history.pushState(null, '', window.location.href)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [location.pathname, navigate])

  const path   = location.pathname
  const meta   = PAGE_META[path] || PAGE_META['/home']
  const isHome = HOME_PATHS.has(path)

  function initials(u) {
    const n = u?.user_metadata?.full_name || u?.email || 'U'
    return n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  }

  return (
    <div className="tiby-shell">
      <aside className="tiby-sidebar">
        <div className="t-logo"><svg width="20" height="20" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M256,105 C316,105 407,196 407,256 C330,256 256,216 256,105Z" stroke="white" stroke-width="36" stroke-linejoin="round"/>
  <path d="M256,105 C196,105 105,196 105,256 C182,256 256,216 256,105Z" stroke="white" stroke-width="36" stroke-linejoin="round"/>
  <path d="M256,407 C316,407 407,316 407,256 C330,256 256,296 256,407Z" stroke="white" stroke-width="36" stroke-linejoin="round"/>
  <path d="M256,407 C196,407 105,316 105,256 C182,256 256,296 256,407Z" stroke="white" stroke-width="36" stroke-linejoin="round"/>
  <rect x="214" y="214" width="84" height="84" rx="6" stroke="white" stroke-width="30" transform="rotate(45 256 256)"/>
</svg></div>
        {NAV.map(({ to, icon, label }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) => `t-nav-item ${isActive ? 'active' : ''}`}
            title={label}>
            <i className={`ti ${icon}`} aria-hidden="true" />
          </NavLink>
        ))}
        <div className="t-nav-spacer" />
        {canInstall && !isInstalled && (
          <button onClick={install} title="Install Tiby"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 18, padding: 4 }}>
            <i className="ti ti-download" aria-hidden="true" />
          </button>
        )}
        <div className="t-avatar" title="Settings" onClick={() => navigate('/settings')}>
          {user?.user_metadata?.avatar_url
            ? <img src={user.user_metadata.avatar_url} alt="" />
            : initials(user)
          }
        </div>
      </aside>

      <div className="tiby-main">
        {!isHome && (
          <div className="t-topbar">
            <div className="t-page-icon" style={{ background: meta.bg, color: meta.color }}>
              <i className={`ti ${meta.icon}`} aria-hidden="true" />
            </div>
            <div>
              <div className="t-page-title">{meta.title}</div>
              <div className="t-page-sub">{meta.sub}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setOverlayOpen(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 20, padding: 4, display: 'flex' }}>
                <i className="ti ti-microphone" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Routes>
            <Route path="/"          element={<HomePage user={user} />} />
            <Route path="/home"      element={<HomePage user={user} />} />
            <Route path="/scan"      element={<CardScannerPage />} />
            <Route path="/meetings"  element={<MeetingPage />} />
            <Route path="/contacts"  element={<ContactsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/search"    element={<SearchPage />} />
            <Route path="/settings"  element={<SettingsPage user={user} />} />
          </Routes>
        </div>

        <nav className="t-bottom-nav">
          {NAV.map(({ to, icon, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}>
              <i className={`ti ${icon}`} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      {overlayOpen && (
        <WakeWordOverlay onCommand={handleCommand} onDismiss={() => setOverlayOpen(false)} />
      )}
      <Toaster position="top-center" />
    </div>
  )
}

// Toast for "press back again to exit"
function showExitToast() {
  let el = document.getElementById('t-exit-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 't-exit-toast'
    el.style.cssText = `
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      background: #1a1a1a; color: #fff; padding: 10px 20px; border-radius: 20px;
      font-size: 13px; font-family: inherit; z-index: 9999;
      opacity: 0; transition: opacity .2s; pointer-events: none;
    `
    document.body.appendChild(el)
  }
  el.textContent = 'Press back again to exit'
  el.style.opacity = '1'
  clearTimeout(el._t)
  el._t = setTimeout(() => { el.style.opacity = '0' }, 1800)
}

export default function App() {
  const [user, setUser]   = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (!ready) return (
    <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9f9f8' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 60, height: 60, borderRadius: 16, background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}><svg width="32" height="32" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M256,105 C316,105 407,196 407,256 C330,256 256,216 256,105Z" stroke="white" stroke-width="36" stroke-linejoin="round"/>
  <path d="M256,105 C196,105 105,196 105,256 C182,256 256,216 256,105Z" stroke="white" stroke-width="36" stroke-linejoin="round"/>
  <path d="M256,407 C316,407 407,316 407,256 C330,256 256,296 256,407Z" stroke="white" stroke-width="36" stroke-linejoin="round"/>
  <path d="M256,407 C196,407 105,316 105,256 C182,256 256,296 256,407Z" stroke="white" stroke-width="36" stroke-linejoin="round"/>
  <rect x="214" y="214" width="84" height="84" rx="6" stroke="white" stroke-width="30" transform="rotate(45 256 256)"/>
</svg></div>
        <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</div>
      </div>
    </div>
  )

  if (!user) return <LoginPage />

  return (
    <BrowserRouter>
      <AppInner user={user} />
    </BrowserRouter>
  )
}
