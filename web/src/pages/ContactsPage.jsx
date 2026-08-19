import { useState, useEffect } from 'react'

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1i2g6CyilXM--qk35qHwydYkyokvd0L0oEjO7b8BNW6I'
const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''

const COLORS = ['ti-amber','ti-blue','ti-green','ti-purple','ti-red']

export default function ContactsPage() {
  const [contacts, setContacts] = useState([])
  const [filtered, setFiltered] = useState([])
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => { fetchContacts() }, [])
  useEffect(() => {
    const q = search.toLowerCase()
    setFiltered(q ? contacts.filter(c => `${c.name}${c.email}${c.company}`.toLowerCase().includes(q)) : contacts)
  }, [search, contacts])

  async function fetchContacts() {
    setLoading(true)
    try {
      // Fetch contacts from Apps Script
      const res  = await fetch(APPS_SCRIPT_URL + '?action=get-contacts')
      const data = await res.json()
      if (data.contacts) setContacts(data.contacts)
    } catch {
      // Fallback — show empty with sheet link
      setContacts([])
    } finally { setLoading(false) }
  }

  function initials(name) {
    if (!name) return '?'
    return name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
  }

  function colorFor(i) { return COLORS[i % COLORS.length] }

  const mailtoLink = (c) => {
    if (!c.email) return null
    return `mailto:${c.email}?subject=Following up&body=Hi ${c.name||''},`
  }

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>

      {/* Search */}
      <div className="t-search-wrap">
        <i className="ti ti-search" aria-hidden="true"/>
        <input className="t-input" placeholder="Search contacts…" value={search} onChange={e=>setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div style={{ textAlign:'center',padding:'40px 0',color:'#9ca3af',fontSize:13 }}>
          Loading contacts…
        </div>
      ) : filtered.length === 0 ? (
        <div className="t-card" style={{ textAlign:'center',padding:'28px 16px' }}>
          <i className="ti ti-users" style={{ fontSize:36,color:'#d1d5db',display:'block',marginBottom:10 }} aria-hidden="true"/>
          <div style={{ fontSize:14,fontWeight:600,color:'#1a1a1a',marginBottom:6 }}>
            {search ? 'No contacts found' : 'No contacts yet'}
          </div>
          <div style={{ fontSize:13,color:'#6b7280',marginBottom:16 }}>
            {search ? 'Try a different search term' : 'Scan a visiting card to add your first contact'}
          </div>
          <a href={SHEET_URL} target="_blank" rel="noreferrer" className="t-btn t-btn-ghost" style={{ textDecoration:'none',display:'flex',width:'auto',padding:'9px 16px',fontSize:13 }}>
            <i className="ti ti-external-link" aria-hidden="true"/> Open in Sheets
          </a>
        </div>
      ) : (
        <>
          <div style={{ fontSize:12,color:'#9ca3af',paddingLeft:2 }}>{filtered.length} contact{filtered.length!==1?'s':''}</div>
          <div className="t-card" style={{ padding:'4px 14px' }}>
            {filtered.map((c,i) => (
              <div key={i} className="t-row" onClick={()=>setSelected(selected===i?null:i)} style={{ cursor:'pointer' }}>
                <div className={`t-row-av ${colorFor(i)}`}>{initials(c.name)}</div>
                <div style={{ flex:1,minWidth:0 }}>
                  <div className="t-row-name" style={{ overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{c.name||'Unknown'}</div>
                  <div className="t-row-sub" style={{ overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                    {[c.company,c.role].filter(Boolean).join(' · ')||c.email||'No details'}
                  </div>
                </div>
                {c.email && (
                  <a href={mailtoLink(c)} onClick={e=>e.stopPropagation()}
                    style={{ color:'#6b7280',textDecoration:'none',flexShrink:0 }}>
                    <i className="ti ti-mail" style={{ fontSize:18 }} aria-hidden="true"/>
                  </a>
                )}
              </div>
            ))}
          </div>

          {/* Selected contact detail */}
          {selected !== null && filtered[selected] && (
            <div className="t-card accent">
              <div className="t-card-head">
                <div className={`t-row-av ${colorFor(selected)}`} style={{ width:40,height:40,borderRadius:10,fontSize:14 }}>
                  {initials(filtered[selected].name)}
                </div>
                <div>
                  <div className="t-ct">{filtered[selected].name||'Unknown'}</div>
                  <div className="t-cs">{filtered[selected].role||filtered[selected].company||''}</div>
                </div>
              </div>
              {[
                ['Company', filtered[selected].company],
                ['Email',   filtered[selected].email],
                ['Phone',   filtered[selected].phone],
                ['Website', filtered[selected].website],
              ].filter(([,v])=>v).map(([l,v])=>(
                <div key={l} style={{ display:'flex',gap:10,padding:'6px 0',borderBottom:'1px solid #f0f0ef',fontSize:13 }}>
                  <span style={{ color:'#9ca3af',minWidth:60 }}>{l}</span>
                  <span style={{ color:'#1a1a1a' }}>{v}</span>
                </div>
              ))}
              {filtered[selected].email && (
                <a href={mailtoLink(filtered[selected])} className="t-btn t-btn-primary" style={{ marginTop:12,textDecoration:'none',display:'flex' }}>
                  <i className="ti ti-mail" aria-hidden="true"/> Draft email
                </a>
              )}
              {filtered[selected].drive_url && (
                <a href={filtered[selected].drive_url} target="_blank" rel="noreferrer" className="t-btn t-btn-ghost" style={{ textDecoration:'none',display:'flex' }}>
                  <i className="ti ti-photo" aria-hidden="true"/> View card
                </a>
              )}
            </div>
          )}

          <a href={SHEET_URL} target="_blank" rel="noreferrer" className="t-btn t-btn-ghost" style={{ textDecoration:'none',display:'flex',marginTop:4 }}>
            <i className="ti ti-external-link" aria-hidden="true"/> View all in Sheets
          </a>
        </>
      )}
    </div>
  )
}
