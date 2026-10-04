# Motion — IG / FB / Threads Scheduler + Comment-to-DM Automations

Monorepo:
- `backend/` NestJS + Prisma (SQLite now, Postgres later)
- `frontend/` Next.js App Router

Meta App: `Motion` ID `1671903081190592` (dev_mode, admin, read+manage).
See `META_SETUP.md` for required Meta dashboard steps + permissions + webhooks.

## Quick start

```powershell
# 1. Backend
cd backend
copy .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run start:dev
# -> http://localhost:3001, webhooks: http://localhost:3001/webhooks/meta

# 2. Frontend
cd ../frontend
copy .env.example .env.local
npm install
npm run dev
# -> http://localhost:3000
```

Use ngrok for webhooks:
```powershell
ngrok http 3001
# set META_WEBHOOK_CALLBACK_URL=https://<ngrok>/webhooks/meta
```

## AI ideas and hook library

`/ideas` generates post ideas (hook, angle, format, caption, hashtags) from a brand profile, and `/hooks` is a
hook library: 32 starter hooks, AI-written hooks for a topic, your own, and favorites. Both call Claude through
the Anthropic SDK (`backend/src/ai/`). Set `ANTHROPIC_API_KEY` in `backend/.env`; `ANTHROPIC_MODEL` overrides
the default `claude-opus-5-5`. Turning on autopilot in the brand profile adds fresh ideas every day at 7am.
