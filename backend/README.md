# ClipForge AI API

Production-oriented API for authorized video processing.

## What it does
- Accepts an uploaded MP4/MOV/WebM/MKV video after a rights confirmation.
- Creates an asynchronous job.
- Probes duration with FFmpeg.
- Transcribes with OpenAI Whisper when `OPENAI_API_KEY` is configured.
- Uses an OpenAI model to rank up to three standalone Shorts.
- Renders each selected segment to 1080x1920 H.264 MP4 with FFmpeg.
- Exposes job status and generated media under `/api/jobs/:id` and `/media`.

## Run locally

```bash
cd backend
npm install
cp .env.example .env
# add OPENAI_API_KEY for real AI transcription/ranking
npm start
```

The API listens on port 8080 by default.

## Render/deployment

Use the included `Dockerfile` on any container host. Persistent storage or S3-compatible object storage is recommended for real users because local container disks can be ephemeral.

Set:
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `WHISPER_MODEL`
- `PUBLIC_BASE_URL`
- `FRONTEND_ORIGIN`
- `MAX_UPLOAD_BYTES`

Never commit secrets to GitHub. GitHub Pages can host the static frontend, but it cannot run this Node/FFmpeg backend.
