import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { sendToSlack } from './slack.js'

// Load .env for local runs (Node >= 20.12). On hosts, vars come from the dashboard
// and there is no .env file, so a missing file is fine.
try {
  process.loadEnvFile()
} catch (err) {
  if (err.code !== 'ENOENT') throw err
}

const PORT = process.env.PORT || 4000
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL
// Comma-separated list of allowed frontend origins, e.g.
// "https://callybre.com,https://www.callybre.com,http://localhost:5173"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

if (!SLACK_WEBHOOK_URL) {
  console.error('Missing SLACK_WEBHOOK_URL env var. Set it before starting the server.')
  process.exit(1)
}

const app = express()
app.set('trust proxy', 1) // behind Render/Railway/etc. proxy -> real client IP for rate limiting
app.use(express.json({ limit: '20kb' }))
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow non-browser requests (curl, health checks) with no Origin header
      if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
        return cb(null, true)
      }
      cb(null, false)
    },
    methods: ['POST', 'GET'],
  })
)

app.get('/', (_req, res) => res.json({ ok: true, service: 'callybre-backend' }))
app.get('/health', (_req, res) => res.json({ ok: true }))

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10, // per IP per 15 min (headroom for client retries during cold starts)
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'Too many submissions. Please try again later.' },
})

const LIMITS = { name: 100, email: 200, phone: 30, service: 100, message: 5000 }
const EMAIL_RE = /^\S+@\S+\.\S+$/

function clean(body) {
  const out = {}
  for (const key of Object.keys(LIMITS)) {
    const v = body?.[key]
    out[key] = typeof v === 'string' ? v.trim().slice(0, LIMITS[key]) : ''
  }
  return out
}

// The frontend retries on timeouts (e.g. Render cold starts) and re-sends queued
// messages on the next visit, each with the same `id`. Remember delivered ids for
// a day so a retry never posts the same message to Slack twice.
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000
const delivered = new Map() // id -> timestamp
const inFlight = new Map() // id -> Promise

function pruneDelivered() {
  const cutoff = Date.now() - DEDUPE_TTL_MS
  for (const [id, t] of delivered) {
    if (t < cutoff) delivered.delete(id)
    else break // Map keeps insertion order, so the rest are newer
  }
}

app.post('/api/contact', contactLimiter, async (req, res) => {
  // Honeypot: real users never fill this hidden field; bots do.
  if (req.body?.website) return res.json({ ok: true })

  const id = typeof req.body?.id === 'string' ? req.body.id.slice(0, 64) : ''
  pruneDelivered()
  if (id && delivered.has(id)) return res.json({ ok: true, duplicate: true })

  const data = clean(req.body)
  const errors = {}
  if (!data.name) errors.name = 'Please enter your name.'
  if (!EMAIL_RE.test(data.email)) errors.email = 'Please enter a valid email.'
  if (!data.message) errors.message = 'Tell us a little about your project.'
  if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors })

  try {
    // If the same id is already being sent (overlapping retry), wait for that send instead
    let send = id && inFlight.get(id)
    if (!send) {
      send = sendToSlack(SLACK_WEBHOOK_URL, data)
      if (id) inFlight.set(id, send)
    }
    await send
    if (id) delivered.set(id, Date.now())
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(502).json({ ok: false, error: 'Could not send your message. Please try again.' })
  } finally {
    if (id) inFlight.delete(id)
  }
})

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }))

app.listen(PORT, () => {
  console.log(`callybre-backend listening on :${PORT}`)
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`)
})
