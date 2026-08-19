import { signOut } from '../services/supabase'

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1i2g6CyilXM--qk35qHwydYkyokvd0L0oEjO7b8BNW6I'

export default function SettingsPage({ user }) {
  const name   = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'
  const email  = user?.email || ''
  const avatar = user?.user_metadata?.avatar_url

  function initials(n) { return n.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase() }

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>

      {/* Profile */}
      <div className="t-card">
        <div className="t-card-head" style={{ marginBottom: 0 }}>
          {avatar ? (
            <img src={avatar} style={{ width:42,height:42,borderRadius:'50%',flexShrink:0 }} alt="" />
          ) : (
            <div style={{ width:42,height:42,borderRadius:'50%',background:'#e8f0fe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontWeight:600,color:'#1a73e8',flexShrink:0 }}>
              {initials(name)}
            </div>
          )}
          <div>
            <div className="t-ct">{name}</div>
            <div className="t-cs">{email}</div>
          </div>
        </div>
      </div>

      {/* Google account */}
      <div className="t-card">
        <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:8 }}>
          <i className="ti ti-brand-google" style={{ fontSize:20,color:'#4285F4' }} aria-hidden="true"/>
          <div className="t-ct" style={{ flex:1 }}>Google account</div>
          <span className="t-tag t-tag-green"><i className="ti ti-check" style={{ fontSize:12 }} aria-hidden="true"/> Connected</span>
        </div>
        <div style={{ fontSize:13,color:'#6b7280' }}>Signed in with {email}</div>
      </div>

      {/* Gmail */}
      <div className="t-card">
        <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:8 }}>
          <i className="ti ti-mail" style={{ fontSize:20,color:'#6b7280' }} aria-hidden="true"/>
          <div className="t-ct" style={{ flex:1 }}>Gmail</div>
          <span className="t-tag t-tag-amber"><i className="ti ti-clock" style={{ fontSize:12 }} aria-hidden="true"/> Pending</span>
        </div>
        <div style={{ fontSize:13,color:'#6b7280',marginBottom:12 }}>
          Connect Gmail to send emails directly from Tiby without copy-pasting.
        </div>
        <button className="t-btn t-btn-primary" style={{ fontSize:13 }}>
          <i className="ti ti-brand-google" aria-hidden="true"/> Connect Gmail
        </button>
        <div style={{ fontSize:12,color:'#9ca3af',marginTop:8,textAlign:'center' }}>Requires Google Cloud Console setup</div>
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

      {/* Data */}
      <div className="t-card">
        <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:8 }}>
          <i className="ti ti-table" style={{ fontSize:20,color:'#065f46' }} aria-hidden="true"/>
          <div className="t-ct">Your data</div>
        </div>
        <div style={{ fontSize:13,color:'#6b7280',marginBottom:12 }}>
          All contacts and meetings are stored in your Google Sheet.
        </div>
        <a href={SHEET_URL} target="_blank" rel="noreferrer" className="t-btn t-btn-ghost" style={{ textDecoration:'none',display:'flex',fontSize:13 }}>
          <i className="ti ti-external-link" aria-hidden="true"/> Open my sheet
        </a>
      </div>

      {/* App info */}
      <div className="t-card">
        <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:10 }}>
          <div style={{ width:32,height:32,borderRadius:9,background:'#1a1a1a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:600,color:'#fff' }}>T</div>
          <div>
            <div className="t-ct">Tiby</div>
            <div className="t-cs">AI Personal Assistant · v1.0</div>
          </div>
        </div>
        <div style={{ fontSize:12.5,color:'#9ca3af',lineHeight:1.6 }}>
          Phase 1: Card scanning, meeting recording, voice email drafting.<br/>
          More features coming in Phase 2.
        </div>
      </div>

      {/* Sign out */}
      <button className="t-btn t-btn-red" onClick={signOut}>
        <i className="ti ti-logout" aria-hidden="true"/> Sign out
      </button>

    </div>
  )
}
