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
# set AUTH_SECRET and TOKEN_ENCRYPTION_KEY in .env (see .env.example)
npx prisma generate
npx prisma migrate deploy
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

## Security

- Every API route needs a signed-in Motion user (`Authorization: Bearer <token>` from `POST /auth/register` or `POST /auth/login`). Only sign-up/sign-in, the Meta OAuth callbacks, the webhook endpoint and `/media/*` files are public.
- Each user sees only the channels they connected, and the posts, automations and inbox that belong to them. Channels connected before user accounts existed go to the first user who registers.
- Meta webhook deliveries must carry a valid `X-Hub-Signature-256` made with `META_APP_SECRET` or `META_IG_APP_SECRET`; anything else gets a 401.
- Meta access tokens are stored encrypted with `TOKEN_ENCRYPTION_KEY` (AES-256-GCM). Existing plaintext tokens are encrypted on the next boot. Keep the key stable: losing it means reconnecting every channel.
- Backend tests: `cd backend && npm test`.
