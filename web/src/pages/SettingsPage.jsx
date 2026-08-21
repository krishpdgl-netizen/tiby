import { useState, useEffect } from 'react'
import { supabase, signOut } from '../services/supabase'
import { getProfile, updateProfile } from '../services/api'

export default function SettingsPage({ user }) {
  const email  = user?.email || ''
  const avatar = user?.user_metadata?.avatar_url

  const [profile, setProfile] = useState({ name: '', mobile: '', organisation: '', role: '' })
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getProfile()
      .then(res => {
        const d = res.data
        setProfile({
          name:         d.name         || '',
          mobile:       d.mobile       || '',
          organisation: d.organisation || '',
          role:         d.role         || '',
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function initials(n) {
    return (n || email).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  }

  async function saveProfile(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateProfile(profile)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {}
    finally { setSaving(false) }
  }

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 13 }}>Loading…</div>
  )

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>

      {/* Profile */}
      <div className="t-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          {avatar
            ? <img src={avatar} style={{ width: 48, height: 48, borderRadius: '50%' }} alt="" />
            : <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 600, color: '#1a73e8' }}>
                {initials(profile.name)}
              </div>
          }
          <div>
            <div className="t-ct">{profile.name || 'Your name'}</div>
            <div className="t-cs">{email}</div>
          </div>
        </div>

        <form onSubmit={saveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['Full name',    'name',         'text', 'Your name'],
            ['Mobile',       'mobile',       'tel',  '+91 98765 43210'],
            ['Organisation', 'organisation', 'text', 'Your company'],
            ['Your role',    'role',         'text', 'Your role'],
          ].map(([label, key, type, ph]) => (
            <div key={key}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.3px' }}>
                {label}
              </label>
              <input className="t-input" type={type} placeholder={ph}
                value={profile[key]} onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))} />
            </div>
          ))}
          <button type="submit" className="t-btn t-btn-primary" disabled={saving} style={{ marginTop: 4 }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save profile'}
          </button>
        </form>
      </div>

      {/* Gmail */}
      <div className="t-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <i className="ti ti-mail" style={{ fontSize: 20, color: '#6b7280' }} aria-hidden="true" />
          <div className="t-ct" style={{ flex: 1 }}>Gmail</div>
          <span className="t-tag t-tag-amber">
            <i className="ti ti-clock" style={{ fontSize: 12 }} aria-hidden="true" /> Pending
          </span>
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
          Connect Gmail to send emails directly.
        </div>
        <button className="t-btn t-btn-ghost" style={{ fontSize: 13 }} disabled>
          Connect Gmail (coming soon)
        </button>
      </div>

      {/* Wake word */}
      <div className="t-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="ti ti-microphone" style={{ fontSize: 20, color: '#6b7280' }} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <div className="t-ct">Wake word</div>
            <div className="t-cs">Say "Hey Tiby" to activate</div>
          </div>
          <div className="t-toggle on" onClick={e => { const t = e.currentTarget; t.classList.toggle('on'); t.classList.toggle('off') }}>
            <div className="t-toggle-knob" />
          </div>
        </div>
      </div>

      {/* Sign out */}
      <button className="t-btn t-btn-red" onClick={signOut}>
        <i className="ti ti-logout" aria-hidden="true" /> Sign out
      </button>
    </div>
  )
}
