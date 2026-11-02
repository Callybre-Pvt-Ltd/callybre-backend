# callybre-backend

Tiny Express API that receives the website contact form and posts it to a Slack channel.

```
POST /api/contact   { name, email, phone?, service?, message }  ->  { ok: true }
GET  /health        ->  { ok: true }
```

Includes: input validation, length limits, CORS allow-list, rate limit (5 / IP / 15 min),
honeypot spam field, and Slack-markup escaping (no `@channel` injection).

## 1. Get a Slack webhook URL

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch** → pick your workspace.
2. Left menu → **Incoming Webhooks** → toggle **On**.
3. **Add New Webhook to Workspace** → choose your contact channel → **Allow**.
4. Copy the URL (`https://hooks.slack.com/services/...`). Keep it secret — anyone with it can post to the channel.

## 2. Run locally

```bash
cp .env.example .env      # paste your webhook URL into .env
npm install
npm run dev               # http://localhost:4000
```

Test:

```bash
curl -X POST http://localhost:4000/api/contact \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"test@example.com","message":"Hello from curl"}'
```

Frontend (`callybre-ui`): `cp .env.example .env.local`, then `npm run dev`. Form posts to `VITE_API_URL`.

## 3. Deploy

Env vars needed on any host:

| Var | Value |
|---|---|
| `SLACK_WEBHOOK_URL` | your webhook URL |
| `ALLOWED_ORIGINS` | `https://callybre.com,https://www.callybre.com` (your site's exact origins, comma-separated) |
| `PORT` | usually set by host automatically |

### Render (free tier, easiest)
1. Push `callybre-backend` to GitHub (own repo, or subfolder of existing one).
2. Render → **New → Web Service** → select repo. If subfolder, set **Root Directory** = `callybre-backend`.
3. Build: `npm install` · Start: `npm start` · Health check path: `/health`.
4. Add env vars above → Deploy. You get e.g. `https://callybre-backend.onrender.com`.
   (Or use **New → Blueprint** — `render.yaml` is included.)

> Free Render instances sleep after ~15 min idle; first request then takes ~30–50 s. Upgrade to a paid instance, or use Railway, to avoid that.

### Railway
New Project → Deploy from GitHub → set root dir `callybre-backend` → add env vars → Settings → Generate Domain.

### Docker / VPS
```bash
docker build -t callybre-backend .
docker run -d -p 4000:4000 --env-file .env --restart unless-stopped callybre-backend
```

## 4. Point the frontend at it

In your frontend host (Vercel/Netlify/etc.) set:

```
VITE_API_URL=https://callybre-backend.onrender.com
```

Then redeploy the frontend (Vite bakes env vars in at build time).
