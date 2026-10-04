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

## AI ideas and hook library

`/ideas` generates post ideas (hook, angle, format, caption, hashtags) from a brand profile, and `/hooks` is a
hook library: 32 starter hooks, AI-written hooks for a topic, your own, and favorites. Both call Claude through
the Anthropic SDK (`backend/src/ai/`). Set `ANTHROPIC_API_KEY` in `backend/.env`; `ANTHROPIC_MODEL` overrides
the default `claude-opus-5-5`. Turning on autopilot in the brand profile adds fresh ideas every day at 7am.

## Pre-flight check

`/preflight` predicts how people will react to a post before it goes out. Upload a reel, image, carousel or
text post (or click "Check before posting" in the composer) and Motion returns a one-line verdict, Weak / OK /
Strong ratings (hook, clarity, visuals, pacing, emotional pull, works muted, call to action), timestamped fixes,
and three stronger openings you can save to the hook library. "Compare versions" ranks 2 or 3 versions by how
well they open.

- Every check runs as a background job (`backend/src/preflight/`). Videos are sampled with ffmpeg (every second
  of the first 3, then spread to the end) plus scene cuts; Claude reviews the frames, caption, script, your brand
  profile and your own past post performance.
- Reels can also go through the optional **audience simulation**: Meta's TRIBE v2 running on a GPU
  (`tribe-service/`). It adds a predicted attention curve with and without sound, likely drop-off moments and
  a muted-autoplay check, which Claude turns into plain advice. Set `TRIBE_SERVICE_URL` and
  `TRIBE_SERVICE_TOKEN` in `backend/.env`; without them the check uses Claude alone.
- All results are estimates and the UI says so. The TRIBE scores are not yet calibrated against real results.
  TRIBE v2 is CC BY-NC 4.0: internal R&D only, not for paying users without a license from Meta.

## Security

- Every API route needs a signed-in Motion user (`Authorization: Bearer <token>` from `POST /auth/register` or `POST /auth/login`). Only sign-up/sign-in, the Meta OAuth callbacks, the webhook endpoint and `/media/*` files are public.
- Each user sees only the channels they connected, and the posts, automations and inbox that belong to them. Channels connected before user accounts existed go to the first user who registers.
- Meta webhook deliveries must carry a valid `X-Hub-Signature-256` made with `META_APP_SECRET` or `META_IG_APP_SECRET`; anything else gets a 401.
- Meta access tokens are stored encrypted with `TOKEN_ENCRYPTION_KEY` (AES-256-GCM). Existing plaintext tokens are encrypted on the next boot. Keep the key stable: losing it means reconnecting every channel.
