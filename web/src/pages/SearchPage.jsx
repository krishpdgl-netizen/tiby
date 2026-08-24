import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchEverything, backfillMemory } from '../services/api'

const ICONS = {
  contact: ['ti-user', '#dbeafe', '#1e40af'],
  meeting: ['ti-microphone', '#fee2e2', '#991b1b'],
  task: ['ti-check', '#ede9fe', '#5b21b6'],
  email: ['ti-mail', '#d1fae5', '#065f46'],
  memory: ['ti-brain', '#fef3c7', '#92400e'],
}

function dateLabel(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [indexing, setIndexing] = useState(false)
  const [indexMessage, setIndexMessage] = useState('')
  const timer = useRef()
  const navigate = useNavigate()

  useEffect(() => {
    clearTimeout(timer.current)
    const q = query.trim()
    if (!q) { setResults([]); setError(''); return }
    timer.current = setTimeout(async () => {
      setLoading(true); setError('')
      try {
        const { data } = await searchEverything(q, 40)
        setResults(data?.results || [])
      } catch (e) {
        setError(e?.response?.data?.detail || 'Search failed')
        setResults([])
      } finally { setLoading(false) }
    }, 280)
    return () => clearTimeout(timer.current)
  }, [query])

  function open(item) {
    if (item.type === 'contact') navigate('/contacts', { state: { contactId: item.id } })
    else if (item.type === 'meeting') navigate('/meetings', { state: { meetingId: item.id } })
    else if (item.type === 'task') navigate('/analytics')
    else if (item.type === 'memory' && item.contact_id) navigate('/contacts', { state: { contactId: item.contact_id } })
  }

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>
      <div className="t-search-wrap" style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9f9f8', paddingBottom: 10 }}>
        <i className="ti ti-search" aria-hidden="true" />
        <input className="t-input" autoFocus placeholder="Search people, meetings, tasks, emails, memories…"
          value={query} onChange={e => setQuery(e.target.value)} />
        {query && <button onClick={() => setQuery('')} aria-label="Clear search"
          style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', padding:4 }}>
          <i className="ti ti-x" />
        </button>}
      </div>

      {!query.trim() && (
        <div className="t-card" style={{ textAlign:'center', padding:'30px 18px' }}>
          <i className="ti ti-search" style={{ fontSize:34, color:'#d1d5db', display:'block', marginBottom:10 }} />
          <div className="t-ct">Search all of Tiby</div>
          <div className="t-cs" style={{ marginTop:5 }}>Try “Rahul pricing”, “API meeting”, or “proposal task”. Semantic memory is included automatically.</div>
          <button className="t-btn t-btn-primary" disabled={indexing} style={{ marginTop:16, width:'auto', display:'inline-flex' }}
            onClick={async () => {
              setIndexing(true); setIndexMessage('')
              try { const { data } = await backfillMemory(); setIndexMessage(`Memory ready · ${data?.memories_added || 0} new items indexed`) }
              catch { setIndexMessage('Could not index existing data. New activity will still be remembered.') }
              finally { setIndexing(false) }
            }}>
            <i className="ti ti-brain" aria-hidden="true" /> {indexing ? 'Building memory…' : 'Index existing Tiby data'}
          </button>
          {indexMessage && <div style={{ fontSize:12,color:'#6b7280',marginTop:8 }}>{indexMessage}</div>}
        </div>
      )}

      {loading && <div style={{ textAlign:'center', color:'#9ca3af', fontSize:13, padding:24 }}>Searching…</div>}
      {error && <div className="t-card" style={{ color:'#991b1b', fontSize:13 }}>{error}</div>}
      {!loading && query.trim() && !error && results.length === 0 && (
        <div className="t-card" style={{ textAlign:'center', color:'#6b7280', fontSize:13 }}>No matching information found.</div>
      )}

      {results.length > 0 && (
        <div className="t-card" style={{ padding:'4px 14px' }}>
          {results.map((r, i) => {
            const [icon,bg,color] = ICONS[r.type] || ICONS.memory
            return (
              <button key={`${r.type}-${r.id}-${i}`} onClick={() => open(r)} className="t-row"
                style={{ width:'100%', background:'none', border:'none', textAlign:'left', cursor:'pointer', fontFamily:'inherit' }}>
                <div style={{ width:36,height:36,borderRadius:10,background:bg,color,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                  <i className={`ti ${icon}`} aria-hidden="true" />
                </div>
                <div style={{ flex:1,minWidth:0 }}>
                  <div className="t-row-name" style={{ overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{r.title}</div>
                  <div className="t-row-sub" style={{ overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                    {[r.type, r.subtitle, dateLabel(r.created_at)].filter(Boolean).join(' · ')}
                  </div>
                  {r.snippet && <div style={{ fontSize:12.5,color:'#6b7280',marginTop:3,lineHeight:1.4,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden' }}>{r.snippet}</div>}
                </div>
                <i className="ti ti-chevron-right" style={{ color:'#d1d5db',fontSize:14 }} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
