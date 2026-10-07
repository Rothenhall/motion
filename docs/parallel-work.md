# Phases 3 to 5: parallel work split (temporary coordination file)

Read `docs/admin-client-plan.md` first (sections 9, 10, 11, 13, 17, 18 and the Phase 1 and 2 status blocks). This file only says who
does what, so five agents can work at the same time without colliding. It is deleted when the work is merged.

## What already exists (the foundation, committed before you started)

Backend (Phases 1 and 2, all tested): tenancy, roles, feature switches, invites and resets, closed sign-up, the admin API under
`/admin/*`, `/team/*`, soft disconnect, `POST /admin/preview/start|exit` (audit only). Read `backend/src/auth/users.controller.ts`
(`GET /auth/me`) and `backend/src/admin/admin-clients.controller.ts` for the exact response shapes.

Frontend foundation (use it, do not reinvent it):

- `frontend/lib/api.ts`: `api()`, `authHeaders({acting?})`, `ApiError` (`status`, `code`, `feature`), `isApiError(e, code?)`,
  `getActing/setActing` (`{id, name, mode: 'view' | 'admin'}` in sessionStorage; every call except `/admin/*` then carries `X-Client-Id`,
  and `X-Preview-Mode: view` in view mode), `signOut()` (also clears the acting client).
- `frontend/lib/session.tsx`: `SessionProvider` (already mounted in `app/layout.tsx`), `useSession()` -> `{status, me, error, refresh}`
  with status `loading | anonymous | ready | suspended | error`, `useMe()`, `isStaff(me)`, `featureOn(me, key)`, `useFeature(key)`.
  `Me` mirrors `GET /auth/me`. Changing the acting client reloads it automatically.
- `frontend/lib/preview.ts`: `startPreview(client, mode)` and `exitPreview(clientId)` (they call the audit endpoints and set/clear the acting client).
- Rules of the product: staff are never blocked by switches on the server; the UI hides switched-off things for clients and for staff in a
  read-only (`view`) preview. `/admin/*` API calls never carry preview headers. Other staff calls that must target a client without
  entering a preview (for example `GET /auth/instagram/start`) pass `headers: { 'X-Client-Id': id }` explicitly.

## Streams, owners and files (stay inside your files)

| Stream | Branch (yours) | Owns (create/edit freely) | Must not edit |
|---|---|---|---|
| A. Client shell (3.1, 3.2, 3.4) | `phase3-shell` | `components/AppShell.tsx`, `components/FeatureGate.tsx`, `components/PreviewBar.tsx`, `app/login/**`, `app/accept-invite/**`, `app/reset-password/**`, `app/connect/**`, `app/<section>/layout.tsx` gates, `app/page.tsx` (dashboard tolerance), small gating edits in `components/Composer.tsx`, `CommandPalette.tsx`, section pages | `app/admin/**`, `components/admin/**`, anything under `backend/` |
| B. Admin console (3.3) | `phase3-admin` | `app/admin/**` (except `approvals/`), `components/admin/**`, `lib/admin.ts`, `app/admin/admin.css`, and in the backend only `src/auth.controller.ts` (`done`/`fail` redirects) + its tests | `components/AppShell.tsx`, `app/connect/**`, `components/Composer.tsx` |
| C. Approvals backend (4) | `phase4-backend` | `backend/prisma/**` (the only stream that adds a migration), `src/posts.controller.ts`, `src/scheduler.service.ts`, new `src/admin/admin-approvals.controller.ts`, `src/approvals*.ts`, `test/approvals.spec.ts` | `frontend/**`, `src/auth.controller.ts`, `src/scripts/**` |
| D. Approvals frontend (4) | `phase4-frontend` | `app/admin/approvals/**`, `components/admin/ApprovalsTab.tsx`, `lib/approvals.ts`, `components/approvals/**`, approval parts of `components/Composer.tsx`, `components/studio/PostDrawer.tsx`, `app/planner/page.tsx`, `lib/posts.ts` | `components/AppShell.tsx`, `app/admin/layout.tsx`, `app/admin/clients/**` |
| E. Hardening (5) | `phase5-hardening` | `backend/src/scripts/seed-demo.ts`, `backend/src/tenancy/media-ownership.service.ts`, `backend/src/media.controller.ts`, `docs/runbook.md`, `docs/security-review.md`, `README.md`, `.github/workflows/ci.yml`, new `test/hardening.spec.ts` | `prisma/**`, `posts.controller.ts`, `scheduler.service.ts`, `frontend/**` |

Shared hot spots, handled by the integrator (not by you): `app/globals.css`, `app.module.ts` provider/controller lists, the route lists in
`test/tenancy.spec.ts`, `docs/admin-client-plan.md`, the nav entries and badges in `AppShell.tsx` for admin and approvals, and the
`Approvals` tab registration in the admin client page. If you must touch one, keep the edit to a few clearly separate lines and say so in your report.

## Rules for every stream

1. Work only in your own git worktree and branch. Commit there with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
   Never push. Never switch branches in, or touch, the main checkout at `C:\Users\offic\OneDrive\Desktop\motion` (it has someone else's
   uncommitted work).
2. Install your own dependencies in your worktree (`npm ci` in `frontend/` and/or `backend/`). Do not link `node_modules` from elsewhere.
   Add no new dependency without saying why in your report.
3. Backend tests need their own database, because all streams run at once and the test database is dropped and rebuilt on every run.
   Use `TEST_DATABASE_URL=postgresql://motion:motion@localhost:5432/<your db>?schema=public` with a name unique to you
   (`motion_test_b`, `motion_test_c`, `motion_test_e`). Docker Postgres is already running as `motion-db-1`; if Docker is stopped, start
   Docker Desktop and run `docker compose up -d db`. **Never** run any prisma command (migrate, reset, db push) against the `motion` database,
   and never start the backend against it. The seven pre-flight ffmpeg tests fail on this machine; that is expected.
4. New CSS goes in a new file next to your code (imported from your own layout or component), not in `app/globals.css`. Reuse the
   existing classes and tokens (`card`, `btn`, `notice`, `field`, the `components/ui/*` kit) so the look matches. No em dashes anywhere in
   website text or code comments. Plain, short sentences in the UI copy.
5. Do not read `backend/.env`, `frontend/.env.local` or `.local-login.txt`, and never print credentials. Test values come from the seed
   and test files.
6. Windows with Git Bash. Node scripts need `C:/...` style paths. Keep each file's existing line endings (most are LF in the working copy).
7. Prove it works: run the checks for what you touched (frontend: `npx tsc --noEmit`, `npx next lint`, `npx vitest run`, and
   `npx next build` once at the end; backend: `npx tsc --noEmit` and the relevant jest specs). Add tests for new behaviour. For UI, also
   look at it in the browser pane if you can start a dev server on a free port with your own worktree (do not use ports 3000 or 3001,
   which belong to the user's running app).
8. Finish with a short report: what you built, files changed, tests added and results, anything you could not finish, every shared
   hot spot you touched, and anything the integrator must wire (exact lines).

## The approvals contract (streams C and D both build to this)

Data: `Client.requireApproval` (already in the schema). `ScheduledPost` gains `approvalStatus String?` (`null` | `PENDING` | `APPROVED` |
`CHANGES_REQUESTED`), `approvalNote String?`, `approvalDecidedAt DateTime?`, `approvalDecidedById String?`. A new post status
`PENDING_APPROVAL` exists beside `SCHEDULED|PUBLISHING|PUBLISHED|FAILED`; the scheduler never publishes it.

Behaviour:

- When the acting client has `requireApproval` and the caller is a **client user**, `POST /posts` saves the post as `status: 'PENDING_APPROVAL'`,
  `approvalStatus: 'PENDING'` and returns it as usual. Staff (any mode) create posts as `SCHEDULED` with `approvalStatus: null`.
  Staff bypass approval; the post's `createdById` is still the staff user.
- A client user editing (`PATCH /posts/:id`) a post that is `PENDING_APPROVAL`, `CHANGES_REQUESTED` or already approved-but-unpublished
  goes back to `PENDING_APPROVAL` / `PENDING` (clearing the note). Editing a published post stays forbidden as today.
- `POST /posts/:id/resubmit` (client): only for `CHANGES_REQUESTED`; moves it back to `PENDING_APPROVAL` / `PENDING`. 400 otherwise.
- Every post JSON the existing endpoints return gains `approvalStatus`, `approvalNote`, `approvalDecidedAt` (all nullable).
- `GET /auth/me` -> `client.requireApproval: boolean` (so the composer can say "Submit for approval").
- `PATCH /admin/clients/:id` accepts `requireApproval: boolean`; the client rows/detail from `/admin/clients*` include `requireApproval`.
  Turning it off leaves already-pending posts pending until decided.

Staff endpoints (ADMIN only, 404 for everyone else), in a new controller:

- `GET /admin/approvals?clientId=` -> `{ items: Item[], total: number }` of posts with `approvalStatus: 'PENDING'`, oldest first (optional `clientId` filter).
- `GET /admin/clients/:id/approvals` -> `{ pending: Item[], recent: Item[] }` (`recent` = last 20 decided, newest first).
- `GET /admin/approvals/count` -> `{ pending: number }`. `GET /admin/overview` gains `approvals: { pending: number }`.
- `POST /admin/approvals/:postId/approve` body `{ scheduledAt?: string }`: sets `SCHEDULED` / `APPROVED`. If the post's time has passed and no
  new future `scheduledAt` is given: 400 `{ code: 'SCHEDULE_TIME_PASSED' }`. 409 `{ code: 'NOT_PENDING' }` if it was already decided.
- `POST /admin/approvals/:postId/request-changes` body `{ note: string }` (required, 3 to 500 chars): sets `CHANGES_REQUESTED`, status stays `PENDING_APPROVAL`.
- `Item` = `{ id, client: {id, name}, account: {id, provider, name}, platform, mediaType, caption, mediaUrls: string[], scheduledAt, createdAt,
  submittedBy: {id, email} | null, approvalStatus, approvalNote, approvalDecidedAt, pastDue: boolean }` (`mediaUrls` parsed from the stored JSON).
- Audit actions: `approval.submit` (client user's post saved as pending, actor = that user), `approval.resubmit`, `approval.approve`,
  `approval.request_changes` (meta has the post id, the note or new time).
