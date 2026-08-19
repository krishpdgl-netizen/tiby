import { useState, useEffect } from 'react'
import { supabase, signOut } from '../services/supabase'

const SHEET_BASE = 'https://docs.google.com/spreadsheets/d/'
const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''

export default function SettingsPage({ user }) {
  const meta   = user?.user_metadata || {}
  const email  = user?.email || ''
  const avatar = meta.avatar_url

  const [profile, setProfile] = useState({
    full_name:    meta.full_name    || '',
    mobile:       meta.mobile       || '',
    organisation: meta.organisation || '',
    role:         meta.role         || '',
  })
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [sheetId, setSheetId] = useState(null)

  useEffect(() => { loadSheetId() }, [])

  async function loadSheetId() {
    // Get sheet ID from user metadata
    const { data: { user: u } } = await supabase.auth.getUser()
    setSheetId(u?.user_metadata?.sheet_id || null)
  }

  function initials(n) {
    return (n||email).split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
  }

  async function saveProfile(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({
        data: { ...meta, ...profile }
      })
      if (!error) { setSaved(true); setTimeout(()=>setSaved(false), 2500) }
    } catch {}
    finally { setSaving(false) }
  }

  async function createSheet() {
    setSaving(true)
    try {
      const res  = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action:'create-user-sheet', email, name: profile.full_name || email }),
      })
      const data = await res.json()
      if (data.sheet_id) {
        // Save sheet ID to user metadata
        await supabase.auth.updateUser({ data: { ...meta, sheet_id: data.sheet_id } })
        setSheetId(data.sheet_id)
      }
    } catch {}
    finally { setSaving(false) }
  }

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>

      {/* Profile */}
      <div className="t-card">
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
          {avatar
            ? <img src={avatar} style={{ width:48,height:48,borderRadius:'50%' }} alt=""/>
            : <div style={{ width:48,height:48,borderRadius:'50%',background:'#e8f0fe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,fontWeight:600,color:'#1a73e8' }}>{initials(profile.full_name)}</div>
          }
          <div>
            <div className="t-ct">{profile.full_name || 'Your name'}</div>
            <div className="t-cs">{email}</div>
          </div>
        </div>

        <form onSubmit={saveProfile} style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            ['Full name',     'full_name',    'text',  'Krish Dhiliwal'],
            ['Mobile',        'mobile',       'tel',   '+91 98765 43210'],
            ['Organisation',  'organisation', 'text',  'Panache DigiLife'],
            ['Your role',     'role',         'text',  'Business Development'],
          ].map(([label, key, type, ph]) => (
            <div key={key}>
              <label style={{ fontSize:11,fontWeight:600,color:'#6b7280',display:'block',marginBottom:4,textTransform:'uppercase',letterSpacing:'.3px' }}>
                {label}
              </label>
              <input className="t-input" type={type} placeholder={ph}
                value={profile[key]} onChange={e=>setProfile(p=>({...p,[key]:e.target.value}))} />
            </div>
          ))}

          <button type="submit" className="t-btn t-btn-primary" disabled={saving} style={{ marginTop:4 }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save profile'}
          </button>
        </form>

        {saved && (
          <div style={{ fontSize:12.5,color:'#065f46',marginTop:8,textAlign:'center' }}>
            Profile saved — emails will now use your details
          </div>
        )}
      </div>

      {/* Personal sheet */}
      <div className="t-card">
        <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:10 }}>
          <i className="ti ti-table" style={{ fontSize:20,color:'#065f46' }} aria-hidden="true"/>
          <div className="t-ct" style={{ flex:1 }}>Your personal sheet</div>
          {sheetId && <span className="t-tag t-tag-green"><i className="ti ti-check" style={{fontSize:12}} aria-hidden="true"/> Active</span>}
        </div>

        {sheetId ? (
          <>
            <div style={{ fontSize:13,color:'#6b7280',marginBottom:12 }}>
              Your contacts, meetings and tasks are stored privately in your own Google Sheet.
            </div>
            <a href={`${SHEET_BASE}${sheetId}`} target="_blank" rel="noreferrer"
              className="t-btn t-btn-ghost" style={{ textDecoration:'none',display:'flex',fontSize:13 }}>
              <i className="ti ti-external-link" aria-hidden="true"/> Open my sheet
            </a>
          </>
        ) : (
          <>
            <div style={{ fontSize:13,color:'#6b7280',marginBottom:12 }}>
              Create your private sheet to store data separately from other users.
            </div>
            <button className="t-btn t-btn-primary" onClick={createSheet} disabled={saving}>
              <i className="ti ti-plus" aria-hidden="true"/> Create my sheet
            </button>
          </>
        )}
      </div>

      {/* Gmail */}
      <div className="t-card">
        <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:8 }}>
          <i className="ti ti-mail" style={{ fontSize:20,color:'#6b7280' }} aria-hidden="true"/>
          <div className="t-ct" style={{ flex:1 }}>Gmail</div>
          <span className="t-tag t-tag-amber"><i className="ti ti-clock" style={{fontSize:12}} aria-hidden="true"/> Pending</span>
        </div>
        <div style={{ fontSize:13,color:'#6b7280',marginBottom:12 }}>
          Connect Gmail to send emails directly. Requires Google Cloud Console setup.
        </div>
        <button className="t-btn t-btn-ghost" style={{ fontSize:13 }} disabled>
          Connect Gmail (coming soon)
        </button>
      </div>

      {/* Wake word */}
      <div className="t-card">
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <i className="ti ti-microphone" style={{ fontSize:20,color:'#6b7280' }} aria-hidden="true"/>
          <div style={{ flex:1 }}>
            <div className="t-ct">Wake word</div>
            <div className="t-cs">Say "Hey Tiby" to activate</div>
          </div>
          <div className="t-toggle on" onClick={e=>{const t=e.currentTarget;t.classList.toggle('on');t.classList.toggle('off')}}>
            <div className="t-toggle-knob"/>
          </div>
        </div>
      </div>

      {/* Sign out */}
      <button className="t-btn t-btn-red" onClick={signOut}>
        <i className="ti ti-logout" aria-hidden="true"/> Sign out
      </button>
    </div>
  )
}
