import { useState, useEffect } from 'react'
import { listContacts, deleteContact, confirmContact } from '../services/api'

const COLORS = ['ti-amber', 'ti-blue', 'ti-green', 'ti-purple', 'ti-red']
const EMPTY_FORM = { name: '', email: '', phone: '', company: '', role: '' }

export default function ContactsPage() {
  const [contacts, setContacts]     = useState([])
  const [filtered, setFiltered]     = useState([])
  const [search, setSearch]         = useState('')
  const [loading, setLoading]       = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [saving, setSaving]         = useState(false)
  const [formErr, setFormErr]       = useState('')

  useEffect(() => { load() }, [])

  useEffect(() => {
    const q = search.toLowerCase()
    setFiltered(q
      ? contacts.filter(c => `${c.name || ''}${c.email || ''}${c.company || ''}`.toLowerCase().includes(q))
      : contacts
    )
    setSelectedId(null)
  }, [search, contacts])

  async function load() {
    setLoading(true)
    try { const { data } = await listContacts(); setContacts(data || []) }
    catch { setContacts([]) }
    finally { setLoading(false) }
  }

  async function handleDelete(id, e) {
    e.stopPropagation()
    if (!confirm('Delete this contact?')) return
    try {
      await deleteContact(id)
      setContacts(prev => prev.filter(c => c.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch {}
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim()) { setFormErr('Name is required'); return }
    setSaving(true); setFormErr('')
    try {
      const { data } = await confirmContact(form, null, {})
      setContacts(prev => [data.contact, ...prev])
      setForm(EMPTY_FORM)
      setShowForm(false)
    } catch (err) {
      setFormErr(err?.response?.data?.detail || 'Failed to save contact')
    } finally { setSaving(false) }
  }

  function initials(name) {
    if (!name) return '?'
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  }
  function colorFor(i) { return COLORS[i % COLORS.length] }

  const selectedContact = selectedId ? contacts.find(c => c.id === selectedId) : null

  const orgs = {}
  contacts.forEach(c => {
    if (c.company) {
      if (!orgs[c.company]) orgs[c.company] = []
      orgs[c.company].push(c)
    }
  })

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>

      {/* Search + Add button */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="t-search-wrap" style={{ flex: 1 }}>
          <i className="ti ti-search" aria-hidden="true" />
          <input className="t-input" placeholder="Search contacts…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="t-btn t-btn-primary"
          style={{ marginTop: 0, width: 'auto', padding: '0 14px', height: 42, flexShrink: 0 }}
          onClick={() => { setShowForm(s => !s); setFormErr('') }}>
          <i className={`ti ${showForm ? 'ti-x' : 'ti-plus'}`} aria-hidden="true" />
          {showForm ? 'Cancel' : 'Add'}
        </button>
      </div>

      {/* Manual add form */}
      {showForm && (
        <div className="t-card">
          <div className="t-card-head">
            <div className="t-icon ti-blue"><i className="ti ti-user-plus" aria-hidden="true" /></div>
            <div>
              <div className="t-ct">Add contact</div>
              <div className="t-cs">Fill in the details manually</div>
            </div>
          </div>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              ['Full name *', 'name',    'text', 'Rahul Sharma'],
              ['Email',       'email',   'email','rahul@company.com'],
              ['Phone',       'phone',   'tel',  '+91 98765 43210'],
              ['Company',     'company', 'text', 'Acme Corp'],
              ['Role',        'role',    'text', 'Sales Manager'],
            ].map(([label, key, type, ph]) => (
              <div key={key}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.3px' }}>
                  {label}
                </label>
                <input className="t-input" type={type} placeholder={ph}
                  value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            {formErr && <p style={{ color: '#991b1b', fontSize: 12.5, margin: 0 }}>{formErr}</p>}
            <button type="submit" className="t-btn t-btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save contact'}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 13 }}>Loading contacts…</div>
      ) : filtered.length === 0 ? (
        <div className="t-card" style={{ textAlign: 'center', padding: '24px 16px' }}>
          <i className="ti ti-users" style={{ fontSize: 36, color: '#d1d5db', display: 'block', marginBottom: 10 }} aria-hidden="true" />
          <div className="t-ct" style={{ marginBottom: 6 }}>{search ? 'No contacts found' : 'No contacts yet'}</div>
          <div className="t-cs">{search ? 'Try a different search' : 'Scan a visiting card or add manually'}</div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: '#9ca3af', paddingLeft: 2 }}>
            {filtered.length} contact{filtered.length !== 1 ? 's' : ''}
          </div>

          {/* Organisation groups */}
          {!search && Object.entries(orgs).filter(([, c]) => c.length > 1).length > 0 && (
            <div className="t-card" style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 10 }}>Organisations</div>
              {Object.entries(orgs).filter(([, c]) => c.length > 1).map(([org, members]) => (
                <div key={org} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{org}</div>
                  <div style={{ display: 'flex' }}>
                    {members.slice(0, 4).map((m, i) => (
                      <div key={i} style={{ width: 24, height: 24, borderRadius: '50%', background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#1a73e8', marginLeft: i ? -6 : 0, border: '1.5px solid #fff' }}>
                        {initials(m.name)}
                      </div>
                    ))}
                    {members.length > 4 && (
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#f5f5f4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#6b7280', marginLeft: -6, border: '1.5px solid #fff' }}>
                        +{members.length - 4}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Contact list */}
          <div className="t-card" style={{ padding: '4px 14px' }}>
            {filtered.map((c, i) => (
              <div key={c.id} className="t-row" onClick={() => setSelectedId(selectedId === c.id ? null : c.id)} style={{ cursor: 'pointer' }}>
                <div className={`t-row-av ${colorFor(i)}`}>{initials(c.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-row-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name || 'Unknown'}
                  </div>
                  <div className="t-row-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[c.company, c.role].filter(Boolean).join(' · ') || c.email || 'No details'}
                  </div>
                </div>
                <button onClick={e => handleDelete(c.id, e)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: 16, padding: 4, flexShrink: 0 }}>
                  <i className="ti ti-trash" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>

          {/* Selected contact detail */}
          {selectedContact && (
            <div className="t-card accent">
              <div className="t-card-head">
                <div className="t-row-av ti-blue" style={{ width: 40, height: 40, borderRadius: 10, fontSize: 14 }}>
                  {initials(selectedContact.name)}
                </div>
                <div>
                  <div className="t-ct">{selectedContact.name || 'Unknown'}</div>
                  <div className="t-cs">{selectedContact.role || selectedContact.company || ''}</div>
                </div>
              </div>
              {[
                ['Company', selectedContact.company],
                ['Email',   selectedContact.email],
                ['Phone',   selectedContact.phone],
                ['Website', selectedContact.website],
              ].filter(([, v]) => v).map(([l, v]) => (
                <div key={l} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid #f0f0ef', fontSize: 13 }}>
                  <span style={{ color: '#9ca3af', minWidth: 60 }}>{l}</span>
                  <span style={{ color: '#1a1a1a' }}>{v}</span>
                </div>
              ))}
              {selectedContact.email && (
                <a href={`mailto:${selectedContact.email}`}
                  className="t-btn t-btn-primary" style={{ marginTop: 12, textDecoration: 'none', display: 'flex' }}>
                  <i className="ti ti-mail" aria-hidden="true" /> Send email
                </a>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
