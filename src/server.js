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
  limit: 5, // 5 submissions per IP per 15 min
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

app.post('/api/contact', contactLimiter, async (req, res) => {
  // Honeypot: real users never fill this hidden field; bots do.
  if (req.body?.website) return res.json({ ok: true })

  const data = clean(req.body)
  const errors = {}
  if (!data.name) errors.name = 'Please enter your name.'
  if (!EMAIL_RE.test(data.email)) errors.email = 'Please enter a valid email.'
  if (!data.message) errors.message = 'Tell us a little about your project.'
  if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors })

  try {
    await sendToSlack(SLACK_WEBHOOK_URL, data)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(502).json({ ok: false, error: 'Could not send your message. Please try again.' })
  }
})

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }))

app.listen(PORT, () => {
  console.log(`callybre-backend listening on :${PORT}`)
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`)
})
