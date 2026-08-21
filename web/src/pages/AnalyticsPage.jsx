import { useState, useEffect } from 'react'
import { getAnalytics, listTasks, completeTask, reopenTask, prioritizeTasks, generateEOD } from '../services/api'

const PRIORITY_STYLE = {
  high:   { bg:'#fee2e2', color:'#991b1b', label:'High' },
  medium: { bg:'#fef3c7', color:'#92400e', label:'Med' },
  low:    { bg:'#f0fdf4', color:'#065f46', label:'Low' },
  '':     { bg:'#f5f5f4', color:'#6b7280', label:'—' },
}

export default function AnalyticsPage() {
  const [stats, setStats]           = useState(null)
  const [tasks, setTasks]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [prioritising, setPri]      = useState(false)
  const [filter, setFilter]         = useState('all')
  const [taskView, setTaskView]     = useState('mine')  // 'mine' | 'assigned'
  const [eodSummary, setEod]        = useState(null)
  const [eodLoading, setEodLoad]    = useState(false)
  const [priorities, setPriorities] = useState({})

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    function onVisible() { if (document.visibilityState === 'visible') loadAll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [statsRes, tasksRes] = await Promise.all([getAnalytics(), listTasks()])
      setStats(statsRes.data)
      setTasks(tasksRes.data || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function markDone(task) {
    setTasks(prev => prev.map(t => t.id === task.id ? {...t, status:'done'} : t))
    try {
      await completeTask(task.id)
      setStats(s => s ? {...s, tasks_pending: Math.max(0,(s.tasks_pending||1)-1), tasks_done:(s.tasks_done||0)+1} : s)
    } catch {
      setTasks(prev => prev.map(t => t.id === task.id ? {...t, status:'pending'} : t))
    }
  }

  async function markPending(task) {
    setTasks(prev => prev.map(t => t.id === task.id ? {...t, status:'pending'} : t))
    try {
      await reopenTask(task.id)
      setStats(s => s ? {...s, tasks_pending:(s.tasks_pending||0)+1, tasks_done:Math.max(0,(s.tasks_done||1)-1)} : s)
    } catch {
      setTasks(prev => prev.map(t => t.id === task.id ? {...t, status:'done'} : t))
    }
  }

  async function handlePrioritise() {
    setPri(true)
    try {
      const res = await prioritizeTasks()
      const pending = visibleTasks.filter(t => t.status === 'pending')
      const map = {}
      ;(res.data?.priorities || []).forEach((p, i) => {
        if (pending[i]) map[pending[i].id] = p
      })
      setPriorities(map)
    } catch {}
    finally { setPri(false) }
  }

  async function handleEOD() {
    setEodLoad(true)
    try {
      const res = await generateEOD()
      setEod(res.data)
    } catch {}
    finally { setEodLoad(false) }
  }

  // Split tasks into mine vs assigned-to-me
  const myTasks       = tasks.filter(t => t.created_by_me !== false)
  const assignedTasks = tasks.filter(t => t.assigned_to_me === true)

  const visibleTasks = taskView === 'assigned' ? assignedTasks : myTasks

  const filtered = visibleTasks.filter(t =>
    filter === 'all' ? true : filter === 'pending' ? t.status === 'pending' : t.status === 'done'
  )
  const pending = myTasks.filter(t => t.status === 'pending').length
  const done    = myTasks.filter(t => t.status === 'done').length

  return (
    <div className="t-content" style={{ paddingTop: 16 }}>

      {/* Stats */}
      {loading ? (
        <div style={{ textAlign:'center', padding:'40px 0', color:'#9ca3af', fontSize:13 }}>Loading…</div>
      ) : stats && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {[
            { label:'Cards scanned',    value: stats.contacts,           icon:'ti-id',         bg:'#fef3c7', color:'#92400e' },
            { label:'Meetings done',    value: stats.meetings,           icon:'ti-microphone',  bg:'#fee2e2', color:'#991b1b' },
            { label:'Tasks pending',    value: stats.tasks_pending,      icon:'ti-clock',       bg:'#dbeafe', color:'#1e40af' },
            { label:'Tasks done',       value: stats.tasks_done,         icon:'ti-check',       bg:'#d1fae5', color:'#065f46' },
          ].map(s => (
            <div key={s.label} className="t-card" style={{ padding:'14px 16px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <div style={{ width:30, height:30, borderRadius:8, background:s.bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <i className={`ti ${s.icon}`} style={{ fontSize:16, color:s.color }} aria-hidden="true" />
                </div>
                <span style={{ fontSize:11.5, color:'#6b7280', fontWeight:500 }}>{s.label}</span>
              </div>
              <div style={{ fontSize:28, fontWeight:600, color:'#1a1a1a', lineHeight:1 }}>{s.value ?? '—'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Assigned to me badge */}
      {assignedTasks.length > 0 && (
        <div style={{ background:'#ede9fe', border:'1px solid #c4b5fd', borderRadius:11, padding:'10px 14px', display:'flex', alignItems:'center', gap:10 }}>
          <i className="ti ti-user-check" style={{ fontSize:18, color:'#5b21b6' }} aria-hidden="true" />
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:600, color:'#1a1a1a' }}>
              {assignedTasks.filter(t => t.status === 'pending').length} task{assignedTasks.filter(t => t.status === 'pending').length !== 1 ? 's' : ''} assigned to you
            </div>
            <div style={{ fontSize:12, color:'#6b7280' }}>From other Tiby users</div>
          </div>
          <button
            onClick={() => { setTaskView('assigned'); setFilter('pending') }}
            style={{ fontSize:12, color:'#5b21b6', fontWeight:600, background:'none', border:'none', cursor:'pointer', fontFamily:'inherit' }}>
            View →
          </button>
        </div>
      )}

      {/* Progress */}
      {myTasks.length > 0 && (
        <div className="t-card" style={{ padding:'14px 16px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:8 }}>
            <span style={{ fontWeight:600, color:'#1a1a1a' }}>Overall progress</span>
            <span style={{ color:'#6b7280' }}>{done}/{myTasks.length} done</span>
          </div>
          <div className="t-progress">
            <div className="t-progress-fill" style={{ background:'#10b981', width:`${myTasks.length ? (done/myTasks.length)*100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* EOD Summary */}
      <div className="t-card">
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom: eodSummary ? 12 : 0 }}>
          <i className="ti ti-sun" style={{ fontSize:20, color:'#92400e' }} aria-hidden="true" />
          <div style={{ flex:1 }}>
            <div className="t-ct">End of day summary</div>
            <div className="t-cs">AI review of today + what's next</div>
          </div>
          <button className="t-btn t-btn-amber"
            style={{ width:'auto', padding:'6px 12px', fontSize:12, marginTop:0 }}
            onClick={handleEOD} disabled={eodLoading}>
            {eodLoading ? 'Generating…' : 'Generate'}
          </button>
        </div>
        {eodSummary && (
          <>
            <div style={{ background:'#fef3c7', borderRadius:10, padding:12, marginBottom:10 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'.4px', marginBottom:6 }}>Today</div>
              <p style={{ fontSize:13.5, color:'#1a1a1a', lineHeight:1.6, margin:0 }}>{eodSummary.today_summary}</p>
            </div>
            <div style={{ background:'#f0fdf4', borderRadius:10, padding:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#065f46', textTransform:'uppercase', letterSpacing:'.4px', marginBottom:6 }}>Tomorrow's priorities</div>
              <p style={{ fontSize:13.5, color:'#1a1a1a', lineHeight:1.6, margin:0 }}>{eodSummary.tomorrow_plan}</p>
            </div>
          </>
        )}
      </div>

      {/* Tasks */}
      <div className="t-card">
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
          <div style={{ flex:1 }}>
            <div className="t-ct">Action items</div>
            <div className="t-cs">{pending} pending · {done} done</div>
          </div>
          <button className="t-btn t-btn-ghost"
            style={{ width:'auto', padding:'6px 12px', fontSize:12, marginTop:0 }}
            onClick={handlePrioritise} disabled={prioritising}>
            <i className="ti ti-sparkles" aria-hidden="true" />
            {prioritising ? '…' : 'AI Prioritise'}
          </button>
          <button className="t-btn t-btn-ghost"
            style={{ width:'auto', padding:'6px 10px', fontSize:12, marginTop:0 }}
            onClick={loadAll} disabled={loading}>
            <i className="ti ti-refresh" aria-hidden="true" />
          </button>
        </div>

        {/* Mine / Assigned toggle */}
        <div style={{ display:'flex', gap:6, marginBottom:10 }}>
          {[
            { key:'mine',     label:'My tasks' },
            { key:'assigned', label:`Assigned to me${assignedTasks.length > 0 ? ` (${assignedTasks.length})` : ''}` },
          ].map(v => (
            <button key={v.key} onClick={() => setTaskView(v.key)} style={{
              padding:'5px 12px', borderRadius:20, border:'1px solid #e5e5e4',
              fontSize:12.5, cursor:'pointer', fontFamily:'inherit', fontWeight:500,
              background: taskView === v.key ? '#1a1a1a' : '#fff',
              color: taskView === v.key ? '#fff' : '#6b7280',
            }}>
              {v.label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div style={{ display:'flex', gap:6, marginBottom:12 }}>
          {['all', 'pending', 'done'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding:'5px 12px', borderRadius:20, border:'1px solid #e5e5e4',
              fontSize:12.5, cursor:'pointer', fontFamily:'inherit', fontWeight:500,
              background: filter === f ? '#1a1a1a' : '#fff',
              color: filter === f ? '#fff' : '#6b7280',
            }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign:'center', padding:'20px 0', color:'#9ca3af', fontSize:13 }}>
            {taskView === 'assigned'
              ? 'No tasks assigned to you yet'
              : filter === 'done' ? 'No completed tasks yet' : 'No pending tasks — all done! 🎉'}
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {filtered.map(task => {
              const isDone = task.status === 'done'
              const p  = priorities[task.id]
              const ps = PRIORITY_STYLE[p?.priority || '']
              return (
                <div key={task.id} style={{
                  display:'flex', gap:10, alignItems:'flex-start', padding:'10px 12px', borderRadius:10,
                  background: isDone ? '#f9f9f8' : '#fff', border:'1px solid #f0f0ef',
                  opacity: isDone ? .7 : 1, transition:'all .15s',
                }}>
                  <button onClick={() => isDone ? markPending(task) : markDone(task)}
                    style={{
                      width:20, height:20, borderRadius:6,
                      border:`1.5px solid ${isDone ? '#10b981' : '#d1d5db'}`,
                      background: isDone ? '#10b981' : '#fff',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      cursor:'pointer', flexShrink:0, marginTop:1,
                    }}>
                    {isDone && <i className="ti ti-check" style={{ fontSize:11, color:'#fff' }} aria-hidden="true" />}
                  </button>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13.5, color:'#1a1a1a', lineHeight:1.5, textDecoration: isDone ? 'line-through' : 'none' }}>
                      {task.title}
                    </div>
                    <div style={{ display:'flex', gap:10, marginTop:4, flexWrap:'wrap' }}>
                      {task.assigned_to_me && (
                        <span style={{ fontSize:11.5, color:'#5b21b6', fontWeight:600 }}>
                          <i className="ti ti-user-check" style={{ fontSize:11 }} aria-hidden="true" /> Assigned to you
                        </span>
                      )}
                      {task.source === 'meeting' && (
                        <span style={{ fontSize:11.5, color:'#9ca3af' }}>
                          <i className="ti ti-microphone" style={{ fontSize:11 }} aria-hidden="true" /> Meeting
                        </span>
                      )}
                      {task.owner && task.owner !== 'Me' && (
                        <span style={{ fontSize:11.5, color:'#9ca3af' }}>👤 {task.owner}</span>
                      )}
                      {task.due_date && (
                        <span style={{ fontSize:11.5, color:'#9ca3af' }}>📅 {task.due_date}</span>
                      )}
                      {p?.reason && (
                        <span style={{ fontSize:11.5, color:'#6b7280', fontStyle:'italic' }}>{p.reason}</span>
                      )}
                    </div>
                  </div>
                  {p?.priority && (
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
    </div>
  )
}
