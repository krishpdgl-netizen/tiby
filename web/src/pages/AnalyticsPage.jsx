import { useState, useEffect, useCallback } from 'react'
import { getUserContext } from '../services/userProfile'

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''

const PRIORITY_STYLE = {
  high:   { bg:'#fee2e2', color:'#991b1b', label:'High' },
  medium: { bg:'#fef3c7', color:'#92400e', label:'Med' },
  low:    { bg:'#f0fdf4', color:'#065f46', label:'Low' },
  '':     { bg:'#f5f5f4', color:'#6b7280', label:'—' },
}

export default function AnalyticsPage() {
  const [stats, setStats]     = useState(null)
  const [tasks, setTasks]     = useState([])
  const [loading, setLoading] = useState(true)
  const [prioritising, setPrioritising] = useState(false)
  const [filter, setFilter]   = useState('all')
  const [userCtx, setUserCtx] = useState({})

  useEffect(() => { getUserContext().then(ctx => { setUserCtx(ctx); loadAll(ctx) }) }, [])

  async function loadAll(ctx = userCtx) {
    setLoading(true)
    const sid = ctx?.sheet_id ? `&sheet_id=${ctx.sheet_id}` : ''
    try {
      const [analyticsRes, tasksRes] = await Promise.all([
        fetch(`${APPS_SCRIPT_URL}?action=get-analytics${sid}`),
        fetch(`${APPS_SCRIPT_URL}?action=get-tasks${sid}`),
      ])
      const [analytics, tasksData] = await Promise.all([analyticsRes.json(), tasksRes.json()])
      if (analytics.status === 'success') setStats(analytics)
      if (tasksData.status === 'success')  setTasks(tasksData.tasks || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function markDone(task) {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status:'done' } : t))
    try {
      await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action:'mark-done', row: task.row, sheet_id: userCtx.sheet_id }),
      })
    } catch {}
  }

  async function markPending(task) {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status:'pending' } : t))
    try {
      await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action:'mark-done', row: task.row, status:'pending' }),
      })
    } catch {}
  }

  async function prioritise() {
    setPrioritising(true)
    try {
      const sid2 = userCtx?.sheet_id ? `&sheet_id=${userCtx.sheet_id}` : ''
      const res  = await fetch(`${APPS_SCRIPT_URL}?action=prioritise${sid2}`)
      const data = await res.json()
      if (data.priorities) {
        setTasks(prev => prev.map(t => {
          const p = data.priorities.find(p => p.id === t.id)
          return p ? { ...t, priority: p.priority, reason: p.reason } : t
        }))
      }
    } catch {}
    finally { setPrioritising(false) }
  }

  const filtered = tasks.filter(t =>
    filter === 'all' ? true :
    filter === 'pending' ? t.status === 'pending' :
    t.status === 'done'
  )

  const pending = tasks.filter(t => t.status === 'pending').length
  const done    = tasks.filter(t => t.status === 'done').length

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>

      {/* Stats row */}
      {loading ? (
        <div style={{ textAlign:'center', padding:'40px 0', color:'#9ca3af', fontSize:13 }}>Loading…</div>
      ) : stats && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {[
            { label:'Cards scanned', value: stats.contacts,      icon:'ti-id',         bg:'#fef3c7', color:'#92400e' },
            { label:'Meetings done', value: stats.meetings,      icon:'ti-microphone',  bg:'#fee2e2', color:'#991b1b' },
            { label:'Tasks pending', value: stats.tasks_pending, icon:'ti-clock',       bg:'#dbeafe', color:'#1e40af' },
            { label:'Tasks done',    value: stats.tasks_done,    icon:'ti-check',       bg:'#d1fae5', color:'#065f46' },
          ].map(s => (
            <div key={s.label} className="t-card" style={{ padding:'14px 16px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <div style={{ width:30, height:30, borderRadius:8, background:s.bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <i className={`ti ${s.icon}`} style={{ fontSize:16, color:s.color }} aria-hidden="true"/>
                </div>
                <span style={{ fontSize:11.5, color:'#6b7280', fontWeight:500 }}>{s.label}</span>
              </div>
              <div style={{ fontSize:28, fontWeight:600, color:'#1a1a1a', lineHeight:1 }}>{s.value ?? '—'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Progress bar */}
      {tasks.length > 0 && (
        <div className="t-card" style={{ padding:'14px 16px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:8 }}>
            <span style={{ fontWeight:600, color:'#1a1a1a' }}>Overall progress</span>
            <span style={{ color:'#6b7280' }}>{done}/{tasks.length} done</span>
          </div>
          <div className="t-progress">
            <div className="t-progress-fill" style={{ background:'#10b981', width:`${tasks.length ? (done/tasks.length)*100 : 0}%` }}/>
          </div>
        </div>
      )}

      {/* Tasks */}
      <div className="t-card">
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
          <div style={{ flex:1 }}>
            <div className="t-ct">Action items</div>
            <div className="t-cs">{pending} pending · {done} done</div>
          </div>
          <button className="t-btn t-btn-ghost" style={{ width:'auto', padding:'6px 12px', fontSize:12, marginTop:0 }}
            onClick={prioritise} disabled={prioritising}>
            <i className="ti ti-sparkles" aria-hidden="true"/>
            {prioritising ? 'Prioritising…' : 'AI Prioritise'}
          </button>
        </div>

        {/* Filter tabs */}
        <div style={{ display:'flex', gap:6, marginBottom:12 }}>
          {['all','pending','done'].map(f => (
            <button key={f} onClick={()=>setFilter(f)}
              style={{ padding:'5px 12px', borderRadius:20, border:'1px solid #e5e5e4', fontSize:12.5, cursor:'pointer', fontFamily:'inherit', fontWeight:500,
                background: filter===f?'#1a1a1a':'#fff', color: filter===f?'#fff':'#6b7280' }}>
              {f.charAt(0).toUpperCase()+f.slice(1)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign:'center', padding:'20px 0', color:'#9ca3af', fontSize:13 }}>
            {filter === 'done' ? 'No completed tasks yet' : 'No pending tasks — all done! 🎉'}
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {filtered.map(task => {
              const isDone = task.status === 'done'
              const ps = PRIORITY_STYLE[task.priority || '']
              return (
                <div key={task.id} style={{
                  display:'flex', gap:10, alignItems:'flex-start',
                  padding:'10px 12px', borderRadius:10,
                  background: isDone ? '#f9f9f8' : '#fff',
                  border:'1px solid #f0f0ef',
                  opacity: isDone ? 0.7 : 1,
                  transition:'all .15s',
                }}>
                  {/* Checkbox */}
                  <button onClick={()=>isDone?markPending(task):markDone(task)}
                    style={{ width:20, height:20, borderRadius:6, border:`1.5px solid ${isDone?'#10b981':'#d1d5db'}`,
                      background:isDone?'#10b981':'#fff', display:'flex', alignItems:'center', justifyContent:'center',
                      cursor:'pointer', flexShrink:0, marginTop:1 }}>
                    {isDone && <i className="ti ti-check" style={{ fontSize:12, color:'#fff' }} aria-hidden="true"/>}
                  </button>

                  {/* Content */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13.5, color:'#1a1a1a', lineHeight:1.5, textDecoration:isDone?'line-through':'none' }}>
                      {task.title}
                    </div>
                    <div style={{ display:'flex', gap:10, marginTop:4, flexWrap:'wrap' }}>
                      {task.meeting && (
                        <span style={{ fontSize:11.5, color:'#9ca3af' }}>
                          <i className="ti ti-microphone" style={{ fontSize:11 }} aria-hidden="true"/> {task.meeting}
                        </span>
                      )}
                      {task.owner && task.owner !== 'TBD' && (
                        <span style={{ fontSize:11.5, color:'#9ca3af' }}>
                          👤 {task.owner}
                        </span>
                      )}
                      {task.due && task.due !== 'TBD' && (
                        <span style={{ fontSize:11.5, color:'#9ca3af' }}>
                          📅 {task.due}
                        </span>
                      )}
                      {task.reason && (
                        <span style={{ fontSize:11.5, color:'#6b7280', fontStyle:'italic' }}>{task.reason}</span>
                      )}
                    </div>
                  </div>

                  {/* Priority badge */}
                  {task.priority && (
                    <div style={{ padding:'2px 8px', borderRadius:20, background:ps.bg, color:ps.color, fontSize:11, fontWeight:600, flexShrink:0 }}>
                      {ps.label}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Refresh */}
      <button className="t-btn t-btn-ghost" onClick={loadAll} disabled={loading}>
        <i className="ti ti-refresh" aria-hidden="true"/> Refresh
      </button>

    </div>
  )
}
