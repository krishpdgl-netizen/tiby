import { useState } from 'react'
import { supabase } from '../services/supabase'

export default function LoginPage() {
  const [mode, setMode]       = useState('choose') // choose | email
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState(null)

  async function handleGoogle() {
    setLoading(true); setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'email profile https://www.googleapis.com/auth/gmail.send',
        redirectTo: window.location.origin,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) { setError(error.message); setLoading(false) }
  }

  async function handleMagicLink(e) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true); setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) { setError(error.message); setLoading(false) }
    else { setSent(true); setLoading(false) }
  }

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#f9f9f8', padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        {/* Logo + title */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: '#1a1a1a', display: 'flex', alignItems: 'center',
            justifyContent: 'center', margin: '0 auto 16px',
            fontSize: 22, fontWeight: 600, color: '#fff',
          }}>T</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: '#1a1a1a', marginBottom: 5 }}>
            Welcome to Tiby
          </div>
          <div style={{ fontSize: 14, color: '#6b7280' }}>Your AI personal assistant</div>
        </div>

        {/* Feature list */}
        <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', gap: 9 }}>
          {[
            ['ti-id', '#92400e', '#fef3c7', 'Scan business cards instantly'],
            ['ti-microphone', '#991b1b', '#fee2e2', 'Record meetings and get MOM'],
            ['ti-mail', '#065f46', '#d1fae5', 'Draft and send emails by voice'],
          ].map(([icon, color, bg, text]) => (
            <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: '#1a1a1a' }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className={`ti ${icon}`} style={{ fontSize: 16, color }} aria-hidden="true" />
              </div>
              {text}
            </div>
          ))}
        </div>

        {sent ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📬</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 6 }}>Check your email</div>
            <div style={{ fontSize: 13.5, color: '#6b7280' }}>We sent a magic link to <strong>{email}</strong></div>
          </div>
        ) : mode === 'choose' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Google */}
            <button onClick={handleGoogle} disabled={loading} style={{
              width: '100%', padding: '12px 14px', border: '1px solid #e5e5e4',
              borderRadius: 11, background: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 14, fontWeight: 600, color: '#1a1a1a',
              opacity: loading ? 0.6 : 1, fontFamily: 'inherit',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
              <i className="ti ti-arrow-right" style={{ marginLeft: 'auto', fontSize: 15, color: '#9ca3af' }} aria-hidden="true" />
            </button>

            {/* Email */}
            <button onClick={() => setMode('email')} style={{
              width: '100%', padding: '12px 14px', border: '1px solid #e5e5e4',
              borderRadius: 11, background: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 14, fontWeight: 600, color: '#1a1a1a', fontFamily: 'inherit',
            }}>
              <i className="ti ti-mail" style={{ fontSize: 18, color: '#6b7280' }} aria-hidden="true" />
              Continue with email
              <i className="ti ti-arrow-right" style={{ marginLeft: 'auto', fontSize: 15, color: '#9ca3af' }} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleMagicLink} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              className="t-input"
              type="email" placeholder="your@email.com"
              value={email} onChange={e => setEmail(e.target.value)}
              autoFocus required
            />
            <button type="submit" disabled={loading || !email.trim()} className="t-btn t-btn-primary">
              {loading ? 'Sending…' : 'Send magic link'}
            </button>
            <button type="button" onClick={() => setMode('choose')}
              style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              ← Back
            </button>
          </form>
        )}

        {error && <p style={{ color: '#991b1b', fontSize: 12.5, marginTop: 12, textAlign: 'center' }}>{error}</p>}

        <p style={{ fontSize: 11.5, color: '#9ca3af', textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>
          By signing in you allow Tiby to send emails on your behalf via Gmail.
        </p>
      </div>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css" />
    </div>
  )
}
