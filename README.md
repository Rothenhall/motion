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

## Studio layout

The app is organised as Studio (Overview, Planner, Content Lab, Pre-flight), Engage (Inbox, Automations) and Measure
(Analytics, Connections). The pieces shared between screens live in `frontend/components/studio/` (thumbnails, phone
previews, the post drawer, sparklines, insight lines); `frontend/lib/posts.ts` and `lib/media.ts` hold the post helpers.

- **Planner**: a week or month calendar with thumbnails. Drag a scheduled post to another slot to move it (with Undo).
  Best times are shaded once three published posts have insights. A feed preview shows how the Instagram grid will look.
- **Drafts**: the composer autosaves as you type (`/drafts`). Closing it keeps what you wrote; Overview lists drafts
  to continue. Scheduling a post deletes its draft in the same transaction.
- **Inbox**: comments show the post they were left on (matched on the platform post id). Replying marks the comment done.
- Editing a scheduled post is `PATCH /posts/:id` (time, caption, media). The post keeps its id, so insights stay attached.
  `GET /analytics` returns `postStats` for every measured post, which feeds the best-time and rhythm views.

## AI ideas and hook library

Content Lab (`/lab`) is a board of AI post ideas (hook, angle, format, caption, hashtags) written from a brand profile,
with a Fresh, Saved and Used column you can drag between, plus the hook library: 32 starter hooks, AI-written hooks for a
topic, your own, and favorites. `/ideas` and `/hooks` redirect there. Both call a model on
[OpenRouter](https://openrouter.ai) with strict JSON-schema output (`backend/src/ai/`). Set `OPENROUTER_API_KEY`
in `backend/.env`; `OPENROUTER_MODEL` overrides the default `z-ai/glm-5.3-flash` (pick a model that accepts images
and supports structured outputs). Turning on autopilot in the brand profile adds fresh ideas every day at 7am.

## Pre-flight check

`/preflight` predicts how people will react to a post before it goes out. Upload a reel, image, carousel or
text post (or click "Check before posting" in the composer) and Motion returns a one-line verdict, Weak / OK /
Strong ratings (hook, clarity, visuals, pacing, emotional pull, works muted, call to action), timestamped fixes,
and three stronger openings you can save to the hook library. "Compare versions" ranks 2 or 3 versions by how
well they open.

- Every check runs as a background job (`backend/src/preflight/`). Videos are sampled with ffmpeg (every second
  of the first 3, then spread to the end) plus scene cuts; the AI reviews the frames, caption, script, your brand
  profile and your own past post performance.
- Reels can also go through the optional **audience simulation**: Meta's TRIBE v2 running on a GPU
  (`tribe-service/`). It adds a predicted attention curve with and without sound, likely drop-off moments and
  a muted-autoplay check, each flagged moment tagged with its likely cause; the AI turns that, plus frames grabbed
  at those moments, into timestamped advice. Set `TRIBE_SERVICE_URL` and `TRIBE_SERVICE_TOKEN` in
  `backend/.env`; without them the check uses the AI review alone.
- A finished check opens as a workspace (`frontend/components/preflight/review/`). On a wide screen it fits the window
  with no page scroll: the reel beside the simulated brain, a scrollable timeline docked underneath (it follows the
  playhead; "Fit whole reel" shows all of it), and a details panel that scrolls on its own. Everything shares one
  playhead. The brain carries labels for the systems that are above or below usual at that second, and the Brain tab
  explains each system and how the Attention number is made (the service's own definition, in
  `tribe-service/networks.py` and `scoring.py`). Label positions are general locations on the cortex, not exact parcels.
- A toast announces a check when it finishes, wherever you are in the app, and the composer shows the score for media
  that already has a check.
- All results are estimates and the UI says so. The TRIBE scores are not yet calibrated against real results.
  TRIBE v2 is CC BY-NC 4.0: internal R&D only, not for paying users without a license from Meta.

## Clients and staff

Motion is organised in **client workspaces**: one per brand, holding its channels, drafts, posts, ideas, hooks, brand voice,
checks and analytics. Every user belongs to one workspace and only ever sees that one.

- **Admins** are agency staff. The first account created on an empty database is an admin, and anyone listed in `ADMIN_EMAILS`
  (comma separated, in `backend/.env`) is made one at the next start. An admin can act as any client by sending the header
  `X-Client-Id: <client id>`; adding `X-Preview-Mode: view` makes that read only, so a preview can never change a client's data.
  Clients themselves can never name another client (403), and another client's ids answer 404.
- **Switches** decide what a client can use. Sections (planner, content-lab, preflight, inbox, automations, analytics) and actions
  (compose, schedule, delete-posts, inbox-reply, edit-brand, ai) are on by default except `ai`, which costs money and starts off for a
  client an admin creates. A switched-off feature answers 403 with `code: FEATURE_DISABLED`. Admins are never blocked by switches.
- **Suspending** a client stops its users signing in at once, pauses publishing and automations, and keeps analytics syncing.
- **Sign-up is by invitation.** An admin creates a client (`POST /admin/clients`) and gets back a link for the client's main contact to
  set a password; that contact can invite their own team within the seat limit (`/team/*`). Links last 72 hours (resets 24), work once,
  and are not emailed: pass them on yourself. Set `ALLOW_SIGNUP=true` to let anyone register (local demos only: with it, anyone can register a staff address from `ADMIN_EMAILS`).
  Five wrong passwords lock an account for 15 minutes; disabling someone or resetting a password signs them out at once.
- **Only staff connect channels.** Clients see what is connected but cannot add or remove it. A channel belongs to one client at a time,
  and disconnecting keeps its history while publishing, syncing and automations stop.
- **Existing installs.** The migration adds workspaces without promoting anyone; on the next start every existing user gets a
  workspace of their own (their channels, drafts, ideas, hooks, brand voice and checks move into it) and, if you set `ADMIN_EMAILS`,
  your staff become admins. Set `ADMIN_EMAILS` before updating, or nobody will be able to connect channels. Back up the database first.

See `docs/admin-client-plan.md` for the full design. Day-to-day running (deploying, onboarding a client, backups, error codes) is in `docs/runbook.md`.

**Admin console pages.** _To be filled in: the pages under `/admin` (overview, clients, and a client's Channels, Features, Team, Approvals and Activity tabs) and the preview bar._

## Security

What was checked, what was fixed and what is still open is in `docs/security-review.md`.

- Every API route needs a signed-in Motion user (`Authorization: Bearer <token>` from `POST /auth/register` or `POST /auth/login`). Only sign-up/sign-in, accepting an invite or reset link, the Meta OAuth callbacks, the webhook endpoint and `/media/*` files are public.
- Each client workspace sees only its own channels, posts, automations and inbox, and nobody can name another client's ids (404). Channels connected before workspaces existed go to the first user's workspace.
- Meta webhook deliveries must carry a valid `X-Hub-Signature-256` made with `META_APP_SECRET` or `META_IG_APP_SECRET`; anything else gets a 401.
- Uploads are checked by their first bytes (JPG, PNG, WebP, GIF, MP4 or MOV), stored under a random 128 bit name with an extension Motion chooses, and belong to the client that uploaded them: another client cannot attach, check or publish with them. Files are public by address (Meta has to fetch them), so the long random name is what keeps them private.
- Meta access tokens are stored encrypted with `TOKEN_ENCRYPTION_KEY` (AES-256-GCM). Existing plaintext tokens are encrypted on the next boot. Keep the key stable: losing it means reconnecting every channel.
- Sign-in and sign-up allow 10 attempts a minute per address, and every other route 600 a minute (`429` beyond that). The Meta webhook is exempt, since it is verified by signature. Behind a tunnel or proxy, set `TRUST_PROXY=1` (the number of proxies in front) so each visitor is counted separately instead of all sharing the proxy's address.
- Responses carry standard security headers (helmet). `Cross-Origin-Resource-Policy` is `cross-origin` on purpose: the web app shows uploaded media from the API on another origin.

## Operations

- **Unused uploads.** Files nobody points at (removed posts, abandoned composers, deleted accounts) pile up in the uploads volume. A nightly job finds the ones that no post, draft or pre-flight check uses and that are older than `UPLOAD_CLEANUP_DAYS` (default 14). It only logs what it would remove until you set `UPLOAD_CLEANUP=on`, so read the log first (`docker compose logs backend | grep "unused uploads"`).
- **Publishing needs a reachable `PUBLIC_BASE_URL`.** Meta downloads media from it when a post goes out. If the tunnel is down, scheduled posts fail. The web app previews uploads from the API directly, so previews still work.
- **Backups.** Postgres lives in the `pgdata` Docker volume and nothing exports it. Take dumps yourself, and keep the uploads too. In PowerShell do not redirect `pg_dump` output with `>` (it rewrites the file as UTF-16 and the dump cannot be restored). Dump inside the container and copy the file out: `docker compose exec db pg_dump -U motion -Fc -f /tmp/motion.dump motion`, then `docker compose cp db:/tmp/motion.dump .\motion.dump`. Restore, rollback and the full steps are in `docs/runbook.md`.

## Development

```bash
# backend: needs Postgres (docker compose up -d db) and ffmpeg on PATH for the pre-flight tests
cd backend && npm test && npm run typecheck

# frontend
cd frontend && npm test && npm run lint && npm run typecheck
```

CI (`.github/workflows/ci.yml`) runs both on every pull request. The backend job also builds the app and fails if `prisma/schema.prisma` and the committed migrations disagree (`prisma migrate diff` against a scratch database), so a schema change without a migration cannot merge.

**Sample workspaces.** To look around, or check a screen, without a real account, load the sample data. It creates one staff workspace and three clients with a month of sample numbers, posts, drafts and ideas. Channels hold fake tokens and posts are scheduled days ahead, so nothing can be published to a real platform. It refuses to run without `DEMO_SEED=yes`, only touches the `@motion.test` users below and the workspaces they belong to, and can be run again to reset them:

```bash
docker compose exec -e DEMO_SEED=yes backend node dist/scripts/seed-demo.js
# outside Docker, after npm run build:  DEMO_SEED=yes npm run seed:demo
```

The password for every sample login is `DEMO_PASSWORD` in `backend/src/scripts/seed-demo.ts`.

| Sign in as | What it shows |
|---|---|
| `demo@motion.test` | Staff (admin). Home workspace "Demo studio"; can act as every client below |
| `acme@motion.test` | Main contact of "Acme Bakery": a normal client with a team of three (`acme-invited@motion.test` has not accepted, `acme-disabled@motion.test` was switched off) and a short activity log |
| `northwind@motion.test` | Main contact of "Northwind Studio": restricted, with Analytics and AI switched off, one connected channel, one disconnected channel that kept its history, and a failed post |
| `paused@motion.test` | Main contact of "Paused Co": a suspended client, so signing in is turned away |
