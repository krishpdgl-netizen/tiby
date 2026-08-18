import { useState, useRef, useEffect } from 'react'
import { Mic, Square, Upload, Loader2, CheckCircle, Clock, FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import toast from 'react-hot-toast'
import { startMeeting, uploadMeetingAudio, listMeetings, getMeeting } from '../services/api'

const STATUS = {
  IDLE: 'idle',
  RECORDING: 'recording',
  UPLOADING: 'uploading',
  PROCESSING: 'processing',
  DONE: 'done',
}

export default function MeetingPage() {
  const [meetings, setMeetings] = useState([])
  const [status, setStatus] = useState(STATUS.IDLE)
  const [title, setTitle] = useState('')
  const [currentMeetingId, setCurrentMeetingId] = useState(null)
  const [selectedMeeting, setSelectedMeeting] = useState(null)
  const [elapsed, setElapsed] = useState(0)

  const mediaRecorderRef = useRef()
  const chunksRef = useRef([])
  const timerRef = useRef()
  const pollRef = useRef()

  useEffect(() => {
    fetchMeetings()
  }, [])

  const fetchMeetings = async () => {
    try {
      const { data } = await listMeetings()
      setMeetings(data)
    } catch {
      toast.error('Could not load meetings')
    }
  }

  // ── Recording ─────────────────────────────────────────────
  const startRecording = async () => {
    if (!title.trim()) return toast.error('Give this meeting a title first')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []

      // Create meeting record on server
      const { data } = await startMeeting(title)
      setCurrentMeetingId(data.meeting_id)

      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mr
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(1000) // collect chunks every 1s

      setStatus(STATUS.RECORDING)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } catch (e) {
      toast.error('Microphone access denied')
    }
  }

  const stopAndUpload = () => {
    clearInterval(timerRef.current)

    const mr = mediaRecorderRef.current
    if (!mr) return

    mr.onstop = async () => {
      mr.stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      setStatus(STATUS.UPLOADING)

      try {
        await uploadMeetingAudio(currentMeetingId, blob)
        toast.success('Recording uploaded — processing in background')
        setStatus(STATUS.PROCESSING)
        startPolling(currentMeetingId)
      } catch {
        toast.error('Upload failed — try again')
        setStatus(STATUS.IDLE)
      }
    }
    mr.stop()
  }

  const startPolling = (id) => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await getMeeting(id)
        if (data.status === 'done') {
          clearInterval(pollRef.current)
          setStatus(STATUS.DONE)
          setSelectedMeeting(data)
          fetchMeetings()
          toast.success('MOM ready!')
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current)
          toast.error('Processing failed — try uploading again')
          setStatus(STATUS.IDLE)
        }
      } catch {}
    }, 5000)
  }

  const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Meetings</h1>

      {/* ── Recorder card ── */}
      <div className="card space-y-4">
        <h2 className="font-medium text-gray-800">New Recording</h2>

        <input
          className="input"
          placeholder="Meeting title (e.g. Client call with Rahul)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={status !== STATUS.IDLE}
        />

        {status === STATUS.IDLE && (
          <button onClick={startRecording} className="btn-primary w-full flex items-center justify-center gap-2">
            <Mic size={18} /> Start Recording
          </button>
        )}

        {status === STATUS.RECORDING && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="font-mono text-red-600 text-lg">{formatTime(elapsed)}</span>
              <span className="text-sm text-gray-500">Recording…</span>
            </div>
            <button onClick={stopAndUpload} className="btn-danger w-full flex items-center justify-center gap-2">
              <Square size={16} fill="currentColor" /> Stop & Process
            </button>
          </div>
        )}

        {status === STATUS.UPLOADING && (
          <div className="flex items-center gap-3 text-gray-600">
            <Upload size={18} className="animate-bounce" />
            <span>Uploading audio…</span>
          </div>
        )}

        {status === STATUS.PROCESSING && (
          <div className="flex items-center gap-3 text-gray-600">
            <Loader2 size={18} className="animate-spin" />
            <span>Transcribing &amp; generating MOM… you'll get an email when ready</span>
          </div>
        )}

        {status === STATUS.DONE && (
          <div className="flex items-center gap-3 text-green-600">
            <CheckCircle size={18} />
            <span>Done! MOM sent to your email.</span>
          </div>
        )}
      </div>

      {/* ── MOM viewer ── */}
      {selectedMeeting && selectedMeeting.mom && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-indigo-500" />
            <h2 className="font-medium">{selectedMeeting.title}</h2>
          </div>
          {selectedMeeting.summary && (
            <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{selectedMeeting.summary}</p>
          )}
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown>{selectedMeeting.mom}</ReactMarkdown>
          </div>
          {selectedMeeting.tasks?.length > 0 && (
            <div>
              <h3 className="font-medium text-sm mb-2">Action Items</h3>
              <ul className="space-y-2">
                {selectedMeeting.tasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 text-sm">
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full mt-2 shrink-0" />
                    <span>{t.title}</span>
                    {t.owner && <span className="text-gray-400">— {t.owner}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Past meetings ── */}
      {meetings.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-medium text-gray-800">Past Meetings</h2>
          {meetings.map((m) => (
            <button
              key={m.id}
              onClick={async () => {
                const { data } = await getMeeting(m.id)
                setSelectedMeeting(data)
              }}
              className="w-full text-left card hover:border-indigo-200 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{m.title}</span>
                <StatusBadge status={m.status} />
              </div>
              <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                <Clock size={12} />
                {new Date(m.created_at).toLocaleDateString()}
                {m.duration_seconds && ` · ${formatTime(m.duration_seconds)}`}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    recording: ['bg-red-100 text-red-700', 'Recording'],
    processing: ['bg-yellow-100 text-yellow-700', 'Processing'],
    done: ['bg-green-100 text-green-700', 'Done'],
    failed: ['bg-red-100 text-red-700', 'Failed'],
  }
  const [cls, label] = map[status] || ['bg-gray-100 text-gray-600', status]
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
}
