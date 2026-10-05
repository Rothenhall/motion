# Motion — IG / FB / Threads Scheduler + Comment-to-DM Automations

Monorepo:
- `backend/` NestJS + Prisma + Postgres
- `frontend/` Next.js App Router

Meta App: `Motion` ID `1671903081190592` (dev_mode, admin, read+manage).
See `META_SETUP.md` for required Meta dashboard steps + permissions + webhooks.

## Quick start

Needs Docker. Postgres runs in a container; data lives in the `pgdata` volume.

```powershell
# Option A: everything in Docker
copy backend\.env.example backend\.env    # set AUTH_SECRET, TOKEN_ENCRYPTION_KEY, Meta keys
docker compose up --build
# -> frontend http://localhost:3000, backend http://localhost:3001 (migrations run on start)

# Option B: Postgres in Docker, apps on your machine (hot reload)
docker compose up -d db
cd backend
copy .env.example .env                    # DATABASE_URL already points at the db container
npm install
npx prisma migrate deploy
npm run start:dev
# -> http://localhost:3001, webhooks: http://localhost:3001/webhooks/meta

cd ../frontend
copy .env.example .env.local
npm install
npm run dev
# -> http://localhost:3000
```

Backend tests use a separate `motion_test` database in the same container: `docker compose up -d db`, then `cd backend && npm test`.
If you created the `pgdata` volume before `motion_test` was added, run `docker compose down -v` once to recreate it.

Use ngrok for webhooks:
```powershell
ngrok http 3001
# set META_WEBHOOK_CALLBACK_URL=https://<ngrok>/webhooks/meta
```

## Frontend UI kit

The frontend uses [shadcn/ui](https://ui.shadcn.com) on Tailwind CSS v4 for interactive parts (dialogs, the mobile drawer, menus, tabs, switches, toasts, the ⌘K palette). Add more with `npx shadcn@latest add <component>` from `frontend/`; they land in `frontend/components/ui/`.

- shadcn's colour names (`primary`, `muted`, `border`, …) are mapped to Motion's own tokens in `frontend/app/globals.css`, so new components match both themes with no extra styling.
- Tailwind preflight is off and the hand-written styles live in a `legacy` layer below utilities, so existing pages render as before and utilities win where both apply.
- Use `useConfirm()` (`components/ConfirmDialog.tsx`) instead of `window.confirm`, `toast` from `sonner` for action results, and `lib/format.ts` for channel, format and status labels.

## AI ideas and hook library

`/ideas` generates post ideas (hook, angle, format, caption, hashtags) from a brand profile, and `/hooks` is a
hook library: 32 starter hooks, AI-written hooks for a topic, your own, and favorites. Both call Claude through
the Anthropic SDK (`backend/src/ai/`). Set `ANTHROPIC_API_KEY` in `backend/.env`; `ANTHROPIC_MODEL` overrides
the default `claude-opus-5-5`. Turning on autopilot in the brand profile adds fresh ideas every day at 7am.

## Security

- Every API route needs a signed-in Motion user (`Authorization: Bearer <token>` from `POST /auth/register` or `POST /auth/login`). Only sign-up/sign-in, the Meta OAuth callbacks, the webhook endpoint and `/media/*` files are public.
- Each user sees only the channels they connected, and the posts, automations and inbox that belong to them. Channels connected before user accounts existed go to the first user who registers.
- Meta webhook deliveries must carry a valid `X-Hub-Signature-256` made with `META_APP_SECRET` or `META_IG_APP_SECRET`; anything else gets a 401.
- Meta access tokens are stored encrypted with `TOKEN_ENCRYPTION_KEY` (AES-256-GCM). Existing plaintext tokens are encrypted on the next boot. Keep the key stable: losing it means reconnecting every channel.
