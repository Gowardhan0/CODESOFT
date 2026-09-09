import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { v4 as uuid } from 'uuid';
import ffmpegPath from 'ffmpeg-static';
import OpenAI from 'openai';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const OUTPUTS = path.join(DATA, 'outputs');
await fs.mkdir(UPLOADS, { recursive: true });
await fs.mkdir(OUTPUTS, { recursive: true });

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '2mb' }));
app.use('/media', express.static(DATA));

const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 2_000_000_000) },
  fileFilter: (_req, file, cb) => {
    const ok = /^video\/(mp4|quicktime|webm|x-matroska)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only MP4, MOV, WebM or MKV videos are supported.'), ok);
  }
});

const jobs = new Map();
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function publicBase(req) { return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`; }
function setJob(id, patch) { jobs.set(id, { ...(jobs.get(id) || {}), ...patch, updatedAt: new Date().toISOString() }); }

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'clipforge-api', version: '1.0.0' }));
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.post('/api/analyze', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Video file is required.' });
  if (req.body.rightsConfirmed !== 'true') {
    await fs.rm(req.file.path, { force: true });
    return res.status(400).json({ error: 'You must confirm that you own or have permission to edit this video.' });
  }
  const id = uuid();
  const source = req.file.path;
  const ext = path.extname(req.file.originalname) || '.mp4';
  const normalized = path.join(UPLOADS, `${id}${ext}`);
  await fs.rename(source, normalized);
  const base = publicBase(req);
  setJob(id, { id, status: 'queued', progress: 0, source: `${base}/media/uploads/${path.basename(normalized)}`, filename: req.file.originalname });
  res.status(202).json({ id, status: 'queued' });
  processJob(id, normalized, req.body.title || req.file.originalname).catch(async err => {
    console.error(err);
    setJob(id, { status: 'error', progress: 0, error: err.message });
  });
});

async function processJob(id, source, title) {
  setJob(id, { status: 'processing', progress: 10 });
  const meta = await probe(source);
  setJob(id, { duration: meta.duration, progress: 20 });
  const transcript = await transcribe(source);
  setJob(id, { progress: 45, transcript: transcript?.text || '' });
  const clips = await chooseClips(transcript?.text || '', meta.duration, title);
  setJob(id, { progress: 55, clips });
  const rendered = [];
  for (let i = 0; i < clips.length; i++) {
    const out = path.join(OUTPUTS, `${id}-${i + 1}.mp4`);
    await renderShort(source, out, clips[i].start, clips[i].end);
    rendered.push({ ...clips[i], url: `/media/outputs/${path.basename(out)}` });
    setJob(id, { progress: 55 + Math.round(((i + 1) / clips.length) * 40) });
  }
  setJob(id, { status: 'complete', progress: 100, clips: rendered });
}

async function probe(file) {
  const { stdout } = await exec(ffmpegPath, ['-i', file, '-hide_banner'], { maxBuffer: 10_000_000 }).catch(e => ({ stdout: e.stderr || '' }));
  const match = stdout.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 60;
  return { duration };
}

async function transcribe(file) {
  if (!openai) return { text: '' };
  const result = await openai.audio.transcriptions.create({ file: await fs.open(file, 'r').then(h => h.createReadStream()), model: process.env.WHISPER_MODEL || 'whisper-1', response_format: 'verbose_json' });
  return result;
}

async function chooseClips(text, duration, title) {
  const fallback = [
    { start: Math.max(0, Math.min(duration - 45, 10)), end: Math.max(45, Math.min(duration, 55)), hook: 'The moment that changes how you see this', score: 86 },
    { start: Math.max(0, Math.min(duration - 40, 60)), end: Math.max(40, Math.min(duration, 100)), hook: 'Most people miss this part', score: 82 },
    { start: Math.max(0, Math.min(duration - 35, 120)), end: Math.max(35, Math.min(duration, 155)), hook: 'Here is the key takeaway', score: 79 }
  ];
  if (!openai || !text.trim()) return fallback.filter(c => c.end > c.start);
  const prompt = `Find up to 3 standalone short-video moments in this transcript. Return ONLY JSON array with objects {start,end,hook,score}. Each clip 20-60 seconds. Favor strong hooks, emotion, useful information, context completeness and clean endings. Estimate timestamps from the transcript when timestamps are available; otherwise distribute sensible ranges across the ${Math.round(duration)} second video. Title: ${title}. Transcript:\n${text.slice(0, 30000)}`;
  const r = await openai.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'You are a short-form video editor.' }, { role: 'user', content: prompt }] });
  try { return JSON.parse(r.choices[0].message.content).clips || JSON.parse(r.choices[0].message.content); } catch { return fallback; }
}

async function renderShort(input, output, start, end) {
  const duration = Math.max(5, end - start);
  await exec(ffmpegPath, ['-y', '-ss', String(start), '-i', input, '-t', String(duration), '-vf', "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1", '-c:v', 'libx264', '-preset', process.env.FFMPEG_PRESET || 'veryfast', '-crf', '22', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output], { maxBuffer: 20_000_000 });
}

app.use((err, _req, res, _next) => res.status(400).json({ error: err.message || 'Request failed' }));
const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`ClipForge API listening on ${port}`));
