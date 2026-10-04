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
