import { useState, useEffect, useCallback } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'

import LoginPage      from './pages/LoginPage'
import HomePage       from './pages/HomePage'
import CardScannerPage from './pages/CardScannerPage'
import MeetingPage    from './pages/MeetingPage'
import ContactsPage   from './pages/ContactsPage'
import SettingsPage   from './pages/SettingsPage'
import WakeWordOverlay from './components/WakeWordOverlay'
import { useWakeWord }      from './hooks/useWakeWord'
import { useCommandRouter } from './hooks/useCommandRouter'
import { usePWAInstall }    from './hooks/usePWAInstall'
import AnalyticsPage   from './pages/AnalyticsPage'
import { supabase, signOut } from './services/supabase'

const NAV = [
  { to:'/home',      icon:'ti-home',       label:'Home' },
  { to:'/scan',      icon:'ti-id',         label:'Scan' },
  { to:'/meetings',  icon:'ti-microphone', label:'Meetings' },
  { to:'/contacts',  icon:'ti-users',      label:'Contacts' },
  { to:'/analytics', icon:'ti-chart-bar',  label:'Tasks' },
  { to:'/settings',  icon:'ti-settings',   label:'Settings' },
]

const PAGE_META = {
  '/home':      { icon:'ti-home',       bg:'#f5f5f4', color:'#6b7280', title:'Home',        sub:'Ask Tiby anything' },
  '/scan':      { icon:'ti-id',         bg:'#fef3c7', color:'#92400e', title:'Card scanner', sub:'Scan → extract → email' },
  '/meetings':  { icon:'ti-microphone', bg:'#fee2e2', color:'#991b1b', title:'Meetings',     sub:'Record or scan notes' },
  '/contacts':  { icon:'ti-users',      bg:'#dbeafe', color:'#1e40af', title:'Contacts',     sub:'Your saved contacts' },
  '/analytics': { icon:'ti-chart-bar',  bg:'#ede9fe', color:'#5b21b6', title:'Dashboard',    sub:'Tasks + analytics' },
  '/settings':  { icon:'ti-settings',   bg:'#f5f5f4', color:'#6b7280', title:'Settings',     sub:'Account and preferences' },
}

function AppInner({ user }) {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const { route }  = useCommandRouter()
  const { canInstall, isInstalled, install } = usePWAInstall()
  const navigate   = useNavigate()
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const handler = () => setPath(window.location.pathname)
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const handleWake    = useCallback(() => setOverlayOpen(true), [])
  const handleCommand = useCallback((t) => { setOverlayOpen(false); route(t) }, [route])

  const { isListening, wakeDetected } = useWakeWord({ onWake: handleWake, enabled: false })

  const meta = PAGE_META[path] || PAGE_META['/home']
  const isHome = path === '/home' || path === '/'

  function initials(u) {
    const n = u?.user_metadata?.full_name || u?.email || 'U'
    return n.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
  }

  return (
    <div className="tiby-shell">

      {/* ── Sidebar ── */}
      <aside className="tiby-sidebar">
        <div className="t-logo">T</div>

        {NAV.map(({to,icon,label}) => (
          <NavLink key={to} to={to} className={({isActive})=>`t-nav-item ${isActive?'active':''}`}
            title={label} onClick={()=>setPath(to)}>
            <i className={`ti ${icon}`} aria-hidden="true"/>
          </NavLink>
        ))}

        <div className="t-nav-spacer"/>

        {/* Wake dot */}
        <div title={wakeDetected?'Woke!':isListening?'Listening for Hey Tiby':'Wake word off'}
          style={{width:7,height:7,borderRadius:'50%',marginBottom:8,
            background:wakeDetected?'#10b981':isListening?'#3b82f6':'#e5e5e4',
            transition:'background .3s'}}/>

        {/* Install */}
        {canInstall && !isInstalled && (
          <button onClick={install} title="Install Tiby"
            style={{background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:18,padding:4}}>
            <i className="ti ti-download" aria-hidden="true"/>
          </button>
        )}

        {/* Avatar */}
        <div className="t-avatar" title="Settings" onClick={()=>navigate('/settings')}>
          {user?.user_metadata?.avatar_url
            ? <img src={user.user_metadata.avatar_url} alt=""/>
            : initials(user)
          }
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="tiby-main">

        {/* Topbar — hide on home */}
        {!isHome && (
          <div className="t-topbar">
            <div className="t-page-icon" style={{ background: meta.bg, color: meta.color }}>
              <i className={`ti ${meta.icon}`} aria-hidden="true"/>
            </div>
            <div>
              <div className="t-page-title">{meta.title}</div>
              <div className="t-page-sub">{meta.sub}</div>
            </div>
            <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8}}>
              <button onClick={()=>setOverlayOpen(true)}
                style={{background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:20,padding:4,display:'flex'}}>
                <i className="ti ti-microphone" aria-hidden="true"/>
              </button>
            </div>
          </div>
        )}

        {/* Routes */}
        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <Routes>
            <Route path="/"         element={<HomePage user={user}/>}/>
            <Route path="/home"     element={<HomePage user={user}/>}/>
            <Route path="/scan"     element={<CardScannerPage/>}/>
            <Route path="/meetings" element={<MeetingPage/>}/>
            <Route path="/contacts" element={<ContactsPage/>}/>
            <Route path="/analytics" element={<AnalyticsPage/>}/>
            <Route path="/settings" element={<SettingsPage user={user}/>}/>
          </Routes>
        </div>

        {/* Bottom nav — mobile only */}
        <nav className="t-bottom-nav">
          {NAV.map(({to,icon,label})=>(
            <NavLink key={to} to={to} className={({isActive})=>isActive?'active':''} onClick={()=>setPath(to)}>
              <i className={`ti ${icon}`} aria-hidden="true"/>
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Wake overlay */}
      {overlayOpen && <WakeWordOverlay onCommand={handleCommand} onDismiss={()=>setOverlayOpen(false)}/>}

      <Toaster position="top-center"/>
    </div>
  )
}

export default function App() {
  const [user, setUser]   = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({data:{session}})=>{
      setUser(session?.user??null); setReady(true)
    })
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,session)=>{
      setUser(session?.user??null)
    })
    return ()=>subscription.unsubscribe()
  }, [])

  if (!ready) return (
    <div style={{height:'100dvh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f9f9f8'}}>
      <div style={{textAlign:'center'}}>
        <div style={{width:44,height:44,borderRadius:12,background:'#1a1a1a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:19,fontWeight:600,color:'#fff',margin:'0 auto 12px'}}>T</div>
        <div style={{fontSize:13,color:'#9ca3af'}}>Loading…</div>
      </div>
    </div>
  )

  if (!user) return <LoginPage/>

  return (
    <BrowserRouter>
      <AppInner user={user}/>
    </BrowserRouter>
  )
}
