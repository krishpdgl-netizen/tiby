# Tiby — AI Personal Assistant (PWA)

> Say "Hey Tiby" → scan cards → draft emails → record meetings → get MOM

## Stack
| Layer | Tech | Hosted on |
|---|---|---|
| Frontend (PWA) | React + Vite + Tailwind | Vercel |
| Backend | FastAPI (Python) | Render |
| Worker | Celery | Render (Worker) |
| Database | PostgreSQL | Neon |
| Storage | Object storage | Cloudflare R2 |
| Queue | Redis | Upstash |
| Vision / LLM | Gemini 2.5 Flash Lite | Google AI Studio |
| Speech-to-Text | Nova-2 | Deepgram |
| Text-to-Speech | Cloud TTS | Google Cloud |
| Email | Gmail API | Google |

## Repo structure
```
tiby/
├── backend/                 → Push to GitHub as-is
│   ├── main.py
│   ├── requirements.txt
│   ├── render.yaml          → Render reads this for deploy config
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   │       └── 001_initial.py
│   └── app/
│       ├── core/            config.py, database.py
│       ├── models/          models.py
│       ├── services/        ai, gmail, stt, tts, storage
│       ├── api/v1/endpoints/ contacts, emails, meetings, voice
│       └── workers/         celery_app.py, tasks.py
│
└── web/                     → Push to GitHub as-is
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── vercel.json          → Vercel reads this
    ├── public/
    │   ├── manifest.json    → PWA manifest
    │   ├── sw.js            → Service Worker
    │   ├── offline.html
    │   └── icons/
    └── src/
        ├── App.jsx
        ├── main.jsx
        ├── index.css
        ├── pages/           CardScannerPage, MeetingPage
        ├── components/      WakeWordOverlay
        ├── hooks/           useWakeWord, useCommandRouter, usePWAInstall
        └── services/        api.js
```

## Phase 1 Features
- Business card scanning (camera → Gemini Vision → contact)
- Voice instruction → AI email draft → TTS readback → Gmail send
- Meeting recording → Deepgram STT → Gemini MOM → email delivery
- "Hey Tiby" wake word (Web Speech API, continuous background listening)
- PWA — installable on Android/iOS, works offline (shell)
