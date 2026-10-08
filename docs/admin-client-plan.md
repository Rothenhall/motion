# Motion: admin and client workspaces. Implementation plan

Prepared 2026-10-07. Based on a read of Cailyx (`C:\Users\offic\OneDrive\Desktop\cailyx-main`) and an inventory of Motion at commit `69d64e7`.

## 0. Summary

**Goal.** Rothenhall staff (admins) run Motion on behalf of clients. Each client gets their own workspace with their own channels, content and analytics. Admins can open any client's workspace as that client ("preview"), and decide per client which sections and actions that client may use. **Clients never connect their own social profiles; an admin connects each profile.**

**Approach.** Copy the proven shape of Cailyx (roles, per-client feature switches, a client-scope rule that answers 404, a yellow preview bar, admin console), but adapt it to Motion's existing app: instead of duplicating every page under `/admin/preview/...`, the admin "acts as" a client by sending one header (`X-Client-Id`) on every API call. Almost all 58 existing frontend API calls then work unchanged.

**Biggest piece of work.** Today one user is one workspace. About 140 `userId` references across 16 backend files decide who sees what. They all move to filter by `clientId`, behind one helper and a generic cross-client test, so a missed filter cannot leak data.

**Size.** About 22 to 26 engineer-days for the core, plus 3 to 4 for the optional approval workflow. (My first chat estimate of "about 3 weeks" was rough; this breakdown is the better number.)

**Recommended order with the other plans.** (1) The small fail-closed provider refactor from the X plan, (2) this plan, (3) X integration. The X plan's account-health states and PKCE session table drop straight into the admin "Channels" tab.

## Phase 1 status (backend foundation): done

Built on branch `feat/multi-client-phase1`. All 151 tests that existed before still pass, plus 51 new ones (`backend/test/tenancy.spec.ts`),
and the migration was rehearsed on a copy of the real development database. What changed from the plan below, and why:

| Plan said | What was built | Why |
|---|---|---|
| Existing users become admins | **Nobody is promoted by the migration.** Existing users keep an ordinary role and get a workspace of their own. Staff are named in `ADMIN_EMAILS`; the first account on an empty database is still an admin | Rehearsal on real data showed the oldest user was a leftover test account and the real owner was the ninth. Promoting everyone, or the first user, would have handed cross-client access to throwaway accounts |
| Backfill as a separate script | An idempotent `TenancyBackfillService` runs at every start (safe to leave on), guarded by a database lock | The container runs migrations on start; this moves the data right after, with nothing to remember |
| Sign-up closed from the start | `ALLOW_SIGNUP=false` closes it; **open by default** for now. New sign-ups get their own workspace and are never admins | Phase 2 adds invites; closing it earlier would leave no way to add users |
| Admin may have no home workspace | Every user has a workspace, admins included | Simpler: nothing needs a special case, and the owner keeps working as before |
| Dashboard hides widgets of switched-off sections | Not yet: the dashboard returns the client's own counts regardless | Phase 3 (frontend) hides them |
| Uploads need no switch | `/media/upload` needs only a client; the *use* of a file is what is gated | An upload alone is harmless |
| Sync everyone | `POST /analytics/sync` and the connect callback now sync only the acting client's channels | One client must not be able to trigger a sync of everyone's |

Done in Phase 1: schema and migration; request context, `X-Client-Id` act-as, read-only preview, suspension and disabled users;
`RolesGuard`, `FeatureGuard` and the twelve switches; every controller and service moved from per-user to per-client scope
(posts, drafts, comments, automations, dashboard, analytics, ideas, hooks, brand profile, pre-flight, accounts, media, the connect flow);
upload ownership; scheduler, automations and autopilot respect suspension and switches; demo seed with an admin and a sample client.
The tests include a generated check that **every route is classified** (tenant, signed-in, or public), and they were mutation-tested:
re-introducing seven classic tenancy bugs makes them fail.

Not in Phase 1 (unchanged below): invites, closed sign-up by default, admin API and console, preview bar, soft disconnect, admin-only
connecting, and the frontend work. One test gap: the seven pre-flight tests that build media with `ffmpeg` cannot run on the author's
Windows machine (CI installs it), so the pre-flight create path with media is covered there; the text path is covered here.

## Phase 2 status (invites, admin API, staff-only connecting): done

Built on branch `feat/multi-client-phase2`. 25 new tests (24 in `backend/test/admin.spec.ts`, plus one more classified-routes case in
`tenancy.spec.ts`); the suite is 228 passing, with only the seven ffmpeg pre-flight tests failing on the author's machine. The new
protections were mutation-tested (re-introducing a bug makes a test fail). What was built, and what differs from the plan:

- **Sign-up is closed by default.** Only `ALLOW_SIGNUP=true` opens it; the first account on an empty database is still an admin.
  People join by **invitation links**: random 32-byte token, only its sha256 is stored, 72 hours, single use (the redeem is one
  atomic update, so two clicks cannot both win), and a new link cancels the old one. **No email is sent yet**: the API returns the
  link to the admin (or the client's main contact) to pass on. Reset links work the same way (24 hours) and sign out older sessions.
- **Sessions and sign-in.** Each session token carries the user's `sessionVersion`; it is bumped by a reset, by disabling someone and by
  `POST /auth/logout-all`, so those take effect on the next request. Five wrong passwords lock an account for 15 minutes, and the
  answer is the same as for a wrong password, so it reveals nothing. Unknown and invited users get a decoy password check.
- **Admin API** (`/admin/*`, ADMIN only; everyone else is told the route does not exist): overview with what needs attention, clients
  (create with first contact, edit, suspend, activate, archive, unarchive), seats, the twelve switches in bulk, people (invite, resend,
  reset link, disable, enable), channels and the audit log. Seat limits count active and invited non-admin people and cannot be set
  below what is in use. Staff workspaces cannot be archived. Every change is written to the audit log.
- **Client team** (`/team/*`): the main contact (or staff acting as the client) invites and pauses members within the seat limit.
  Members get 403 `TEAM_FORBIDDEN`, and nobody here can touch the main contact or staff.
- **Connecting is staff only.** `GET /auth/:provider/start`, `POST /accounts` and `DELETE /accounts/:id` are ADMIN only (clients get 404),
  the OAuth state carries the client chosen, and the callback re-checks that the person is still active staff and the client exists
  and is not archived. `POST /auth/exchange`, which returned raw tokens, is gone.
- **One channel, one client.** A channel can be connected to a single client at a time (friendly 409 `CHANNEL_ALREADY_CONNECTED` naming
  the other client, backed by a partial unique index for requests that race). **Disconnecting is soft**: history stays, the token is
  replaced, and publishing, syncing, automations, webhooks and new posts all stop using it. Connecting the same channel to the same
  client again brings it back.

Found while testing, not in the plan: the original `(userId, provider, externalId)` unique rule on channels would have stopped staff
moving a channel from one client to another, because staff are the connecting user for every client. The migration drops it; ownership
is by client now. Also, the one-connected-channel index is created by hand in the migration (Prisma cannot express it) and skipped with a
notice if connected duplicates already exist, so the migration cannot fail on old data.

Not in Phase 2: the frontend (login page still offers "create account", Connect page still shows the connect buttons to non-staff, no
admin console, acting-client switcher or preview bar yet), approvals, and email delivery of links. **Before deploying**, set
`ADMIN_EMAILS` (only staff can connect channels now), take a database dump, and note that sign-up is closed.

## 1. What we copy from Cailyx, and what we change

Verified in Cailyx's code:

| Cailyx | Where | Motion decision |
|---|---|---|
| `Role`: `ADMIN`, `CLIENT_POC`, `CLIENT_MEMBER` | `backend/prisma/schema.prisma` | Copy as is |
| `Client` with `status` (ACTIVE or SUSPENDED) and `seatLimit` | schema | Copy; add `requireApproval` later |
| Users invited, then set a password (`INVITED`, `ACTIVE`, `DISABLED`) | schema, `auth.service.ts` | Copy; invite links are copied from the admin UI (no email service yet) |
| `ClientFeatureFlag(clientId, featureKey, enabled)`; no row means ON | `features.service.ts` | Copy; add action-level keys (section 8) |
| `ClientScopeGuard`: a non-admin may only touch their own client, answered with 404 not 403 | `common/guards/client-scope.guard.ts` | Copy the rule; Motion resolves the client from the user or the act-as header |
| `PermissionsGuard`: admin bypasses | `common/guards/permissions.guard.ts` | Copy: admin bypasses feature switches on the API |
| `FeatureGate` blocks a switched-off page even when the address is typed | `frontend/components/client/FeatureGate.tsx` | Copy; friendly "not switched on for your account" screen |
| `PreviewBar` (yellow strip, "Live data", Admin controls switch, exit) | `frontend/components/admin/preview/preview-bar.tsx` | Copy the idea and look |
| Preview implemented as a duplicated page tree under `/admin/preview/[clientId]/...` | `frontend/app/admin/preview` | **Change.** Motion uses an "acting client" context and a header instead of duplicating pages |
| Only the client's contact can connect Google | Cailyx organic | **Reverse.** In Motion only admins connect channels |

## 2. Current state of Motion (findings that shape the plan)

- **Identity.** `User(email, passwordHash)`. No roles. `POST /auth/register` is open to anyone. Sessions are stateless 7-day signed tokens (`auth/users.controller.ts`, `auth/crypto.ts`). `AuthGuard` already loads the user from the database on every request, so suspension and disabling can take effect immediately without new token machinery.
- **Ownership.** Six models hold a `userId`: `SocialAccount`, `BrandProfile` (one per user), `ContentIdea`, `Hook` (each user gets a copy of the starter hooks), `ContentCheck`, `PostDraft`. `ScheduledPost`, `AutomationRule`, `CommentEvent`, `AccountInsight` and `PostInsight` belong to a user through their account.
- **Where scoping lives.** Counts of `userId` / `user.id` per file: `preflight.service` 28, `hooks.service` 21, `ideas.service` 18, `meta.service` 10, `auth.controller` 10, `preflight.controller` 9, `posts.controller` 7, `drafts.controller` 7, `ideas.controller` 6, `hooks.controller` 6, `comments.controller` 4, `automations.controller` 4, `accounts.controller` 3, plus dashboard, analytics and users.
- **Background jobs** already iterate all accounts or all brand profiles across tenants (`insights.service` `syncAll`, `meta.service` token refresh, `ideas.service` autopilot, the scheduler). They need client-awareness (suspension, switches), not a rewrite.
- **Webhooks** find the tenant through the account (`provider + externalId`), which is safe, but two clients connecting the same social account would be handled twice. We prevent that (section 7).
- **Frontend.** 58 `api()` call sites go through `lib/api.ts`. Two places bypass it and call `fetch` with `authHeaders()` directly: media upload in `components/Composer.tsx` and `components/preflight/shared.tsx`. The nav lives in `components/AppShell.tsx` (8 items, including Connections).
- **Media.** `/media/*` is public static (Meta must fetch files by URL). File names are `timestamp-8hex`. Nothing records which user or client uploaded a file; the pre-flight resolver accepts any existing upload name (`resolveUpload`).
- **Tests.** `backend/test/api.spec.ts` has `data is scoped to its owner`, `AI ideas and hooks are scoped to their owner`, a protected-routes list and registration tests. These are the model for the new tenancy tests and some will need updating.

## 3. Target model

**Concepts.**
- **Client** = a workspace for one brand: its channels, drafts, posts, ideas, hooks, brand voice, checks, automations and analytics.
- **User** has a role. Client users belong to one client. **Admins have an optional "home" client** (this keeps the owner's current data and daily flow working exactly as today after migration, as just another workspace).
- **Acting client** (effective client of a request) = for a client user, their own client; for an admin, the `X-Client-Id` header if present, else their home client.

**Roles and what they may do.**

| Action | ADMIN | CLIENT_POC | CLIENT_MEMBER | Subject to client switches? |
|---|---|---|---|---|
| Sign in | yes | yes | yes | no |
| View own workspace sections | yes (any client via act-as) | yes | yes | yes (section switches) |
| Create or edit drafts and posts | yes | yes | yes | yes (`compose`) |
| Schedule or publish without approval | yes | yes | yes | yes (`schedule`) |
| Delete scheduled posts | yes | yes | yes | yes (`delete-posts`) |
| Reply in inbox | yes | yes | yes | yes (`inbox-reply`) |
| Use AI (ideas, hooks, pre-flight AI) | yes | yes | yes | yes (`ai`) |
| Edit brand voice | yes | yes | yes | yes (`edit-brand`) |
| Manage automations | yes | yes | yes | yes (`automations` section) |
| **Connect, reconnect or disconnect channels** | **yes** | **no** | **no** | never available to clients |
| See connected channels (read only) | yes | yes | yes | no |
| Invite or disable team members | yes | yes (within seats) | no | no |
| Create, suspend or delete clients; set switches; seats | yes | no | no | no |
| Act as another client (preview) | yes | no | no | no |

## 4. Data model (Prisma)

```prisma
enum Role         { ADMIN CLIENT_POC CLIENT_MEMBER }
enum UserStatus   { INVITED ACTIVE DISABLED }
enum ClientStatus { ACTIVE SUSPENDED }

model Client {
  id              String       @id @default(cuid())
  name            String
  status          ClientStatus @default(ACTIVE)
  seatLimit       Int          @default(3)
  requireApproval Boolean      @default(false)   // phase 4
  notes           String?
  createdById     String?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  archivedAt      DateTime?
  users           User[]
  accounts        SocialAccount[]
  flags           ClientFeatureFlag[]
  // drafts, ideas, hooks, brandProfile, checks relate back as well
}

model User {              // existing fields stay
  role           Role       @default(CLIENT_POC)
  status         UserStatus @default(ACTIVE)
  clientId       String?                         // client users: their client; admins: optional home client
  invitedById    String?
  failedAttempts Int        @default(0)
  lockedUntil    DateTime?
  lastLoginAt    DateTime?
  sessionVersion Int        @default(0)          // bump to sign a user out everywhere
  @@index([clientId])
}

model ClientFeatureFlag {
  id String @id @default(cuid())
  clientId String
  featureKey String
  enabled Boolean
  updatedById String?
  updatedAt DateTime @updatedAt
  @@unique([clientId, featureKey])
}

model AuthToken {          // invite and password reset links
  id String @id @default(cuid())
  userId String
  type String               // INVITE | RESET
  tokenHash String @unique  // sha256 of the token; the token itself is never stored
  expiresAt DateTime
  usedAt DateTime?
  createdById String?
  createdAt DateTime @default(now())
}

model AdminAuditLog {
  id String @id @default(cuid())
  at DateTime @default(now())
  actorId String
  clientId String?
  action String             // client.create, channel.connect, feature.set, preview.start, post.approve ...
  targetType String?
  targetId String?
  meta Json?
  @@index([clientId, at])
}

model MediaFile {          // who uploaded what (section 13)
  name String @id
  clientId String
  uploadedById String
  createdAt DateTime @default(now())
  @@index([clientId])
}
```

**Moves from user to client** (add `clientId`, keep `createdById` for audit):
- `SocialAccount` (unique becomes `(provider, externalId)` among connected accounts; see section 7)
- `PostDraft`, `ContentIdea`, `Hook`, `ContentCheck`
- `BrandProfile` (one per **client** now: `clientId @unique`)
- `ScheduledPost`, `AutomationRule`, `CommentEvent`, `AccountInsight`, `PostInsight` keep reaching the client through `account`. Add `ScheduledPost.createdById` (and, in phase 4, `approvalStatus`, `approvedById`, `approvedAt`, `reviewNote`).

The old `userId` columns stay until a later cleanup migration so the change can be rolled back during the first days.

## 5. Request context and authorization

**One resolution point: `AuthGuard`** (already loads the user per request). It now loads `role`, `status`, `clientId`, and the client's `status`, then builds:

```ts
type Ctx = {
  user: { id, email, role }
  clientId: string | null        // effective client
  home: boolean                  // true when acting on own/home client
  asAdmin: boolean               // admin acting on a client other than their own, or any admin request
  features: Record<FeatureKey, boolean>   // lazily loaded and memoized per request
}
```

Rules, in order:
1. User `DISABLED`, or their client `SUSPENDED` (client roles), gives 403 `CLIENT_SUSPENDED` / `ACCOUNT_DISABLED`. Takes effect on the very next request.
2. **Client roles:** effective client = `user.clientId`. If an `X-Client-Id` header is present at all, answer 403 (never legitimate, a sign of tampering).
3. **ADMIN:** effective client = header (validated: the client exists, else 404) or `user.clientId` (home). If neither, routes that need a client answer 400 `CLIENT_REQUIRED`; admin-only routes work without one.
4. **Preview read-only** (section 9): admin + header `X-Preview-Mode: view` + a non-GET method gives 403 `PREVIEW_READ_ONLY`.
5. `@Public()` routes skip all of this, as today.

**Decorators and guards** (new folder `backend/src/tenancy/`):
- `@Ctx()` parameter decorator replaces `@CurrentUser()` in scoped controllers.
- `@Roles(Role.ADMIN)` + `RolesGuard` for admin-only routes (404 for non-admins on `/admin/*` so the area looks absent, 403 elsewhere).
- `@RequireFeature('planner')` + `FeatureGuard` (global, after `AuthGuard`): for client roles reads the flags; **admins bypass** (as Cailyx).
- `scope(ctx)` helper returns `{ clientId: ctx.clientId }` and throws if it is null, so no query can be written without it. Account-scoped queries use `{ account: { clientId } }` via `accountScope(ctx)`.

**Cross-client access always answers 404** (as Cailyx), never 403, so the response does not confirm another client's data exists.

**Safety net.** A generic test (section 16) calls every route as client A, client B and a spoofing client, so a forgotten filter fails CI.

## 6. Authentication and onboarding

- **Closed registration.** `POST /auth/register` works only when there are no users (bootstrap the first admin) or when `ALLOW_SIGNUP=true` (dev and tests). Otherwise 403 "Ask your account manager for an invitation."
- **Existing users** stay ordinary users and each gets a workspace of their own. **Staff are named in `ADMIN_EMAILS`** (and the first account on an empty database is an admin). Nobody is promoted by guessing (see Phase 1 status).
- **Create a client:** `POST /admin/clients { name, pocEmail }` creates the client, a `CLIENT_POC` user in `INVITED` status and an invite token. Response includes the invite link `FRONTEND_URL/accept-invite?token=...` to copy and send. (Token: 32 random bytes, stored as sha256, 72 hour life, single use.)
- **Accept invite:** `POST /auth/accept-invite/validate` (read only, does not consume), `POST /auth/accept-invite { token, password }` sets the password, marks `ACTIVE`, returns a session. Same pattern for **password reset** (`/auth/reset-password...`), where the admin generates the link. Reset and disable bump `sessionVersion`.
- **Login hardening.** Keep the existing throttle (10 a minute). Add per-user lockout: 5 failures locks 15 minutes. Generic error messages (no "no such user").
- **Sessions.** Keep the signed 7-day token, but the guard also compares the token's `sv` claim to `user.sessionVersion`. Role is never read from the token, only from the database.
- **Seats.** `Client.seatLimit` counts `ACTIVE` plus `INVITED` users. POCs may invite members up to the limit; admins can raise it.
- **`GET /auth/me`** returns `{ id, email, role, client: {id,name,status}|null, features, canActAs }`. The frontend builds navigation from this.
- **Later (not in scope).** Email delivery of invites, admin 2FA.

## 7. Connections: admin only

**Backend**
- `GET /auth/:provider/start` becomes `ADMIN` only and takes the target client (header or `?clientId=`). The signed `state` carries `{ adminId, clientId, provider }`. The callback verifies it and passes the client to `MetaService.connect*()`, which now upserts accounts with `clientId`. (When the X plan's `OAuthSession` lands, `clientId` goes in there too, and state becomes single-use.)
- `POST /accounts` (manual token add) becomes `ADMIN` only; `DELETE /accounts/:id` becomes `ADMIN` only.
- `GET /accounts` stays available to clients, read only, with no token fields (already true).
- **One social account, one client.** Enforce a unique `(provider, externalId)` among connected accounts. Connecting an account already connected to another client answers a clear error: "This channel is already connected to <client>. Disconnect it there first." This also keeps webhook handling unambiguous.
- **Fix disconnect while here.** Today `DELETE /accounts/:id` cascades and deletes every post, insight, rule and comment, although the screen says posts only pause. With admins managing many clients that is a costly mistake. Change to **soft disconnect**: set `disconnectedAt`, keep history, stop publishing and syncing, and show "Disconnected" with a Reconnect action. Correct the screen text.
- Remove the unused `POST /auth/exchange` (it returns raw platform tokens).

**Frontend**
- Clients: no Connections nav item and no `/connect` page. A read-only "Channels" card on the Overview shows what is connected and its status, with "Ask your account manager to reconnect" when something is wrong.
- Admins: the existing connect cards move into `/admin/clients/[id]` under the **Channels** tab, calling the connect flow with that client.

**Practical prerequisites (not code).** The admin authorizing a channel needs access to that client's Page or Instagram account (a Page role, Business Manager partner access, or the login). Meta may require App Review / business verification before you can connect client-owned assets with someone who is not an app role holder; confirm in the Meta developer dashboard. For X (later), one browser holds one X login, so the admin needs a separate browser profile per X account.

## 8. Feature switches

Same table as Cailyx (`ClientFeatureFlag`, no row means default). Keys live in one shared constant file and are served to the frontend through `/auth/me` and `GET /admin/clients/:id/features`.

| Key | Kind | Default | Controls |
|---|---|---|---|
| `planner` | section | on | Planner page and calendar endpoints |
| `content-lab` | section | on | Ideas board, hook library, brand voice page |
| `creators` | section | on | Creators tab: chat finder, top-5 search, shortlist |
| `preflight` | section | on | Pre-flight checks |
| `inbox` | section | on | Comment inbox |
| `automations` | section | on | Automation rules |
| `analytics` | section | on | Analytics page and data |
| `compose` | action | on | Create and edit drafts and posts, upload media |
| `schedule` | action | on | Schedule without approval (off sends posts for approval when phase 4 exists) |
| `delete-posts` | action | on | Delete scheduled posts |
| `inbox-reply` | action | on | Reply to comments |
| `edit-brand` | action | on | Change brand voice |
| `ai` | action | **off for new clients** | AI generation and AI pre-flight (costs you money) |

Overview is always on, but each widget needs its section; widgets for switched-off sections are hidden. **Connections is not a switch** (always admin-only).

**Enforcement is in three layers.** (1) Backend `FeatureGuard` on routes (403 with code `FEATURE_DISABLED` and the key). (2) Backend background jobs check flags (autopilot needs `ai` and `content-lab`; automations need `automations`). (3) Frontend `FeatureGate` plus nav filtering, so typed addresses show the "not switched on" screen.

Route to key map (backend): `posts` (`planner`, plus `compose` / `schedule` / `delete-posts` on writes), `drafts` (`compose`), `ideas/hooks/brand-profile` (`content-lab`, `ai` on generate, `edit-brand` on writes), `creators/chat` (`creators`, `ai`), `creators/search` and `creators/shortlist` (`creators`), `preflight` (`preflight`, `ai`), `comments` (`inbox`, `inbox-reply` on reply), `automations` (`automations`), `analytics`/`dashboard` (`analytics`; dashboard returns only permitted parts).

## 9. Preview as client

**Frontend mechanism**
- `ActingClientProvider` keeps `{ clientId, name, mode }` in `sessionStorage` (per browser tab, cleared on sign-out). `lib/api.ts` and the two direct upload calls read it and add `X-Client-Id`, plus `X-Preview-Mode: view` when read only. Because `authHeaders()` is the single place that builds headers, those calls cannot be missed.
- Entry: the **Preview as client** button on `/admin/clients/[id]` sets the acting client and opens `/`. The normal Motion app renders, with the **yellow PreviewBar** pinned on top: "Previewing <Client>", "Live data: changes apply to the client", the mode switch, and **Exit preview**.
- Exit clears the acting client and returns to the client's admin page. Sign-out and sign-in always clear it.

**Two modes (the Admin controls switch)**
1. **View as client (default, read only).** Feature switches and role limits are applied exactly as the client sees them. The backend rejects writes with `PREVIEW_READ_ONLY`, so an admin cannot change a client's data by accident.
2. **Admin controls (can edit).** Flags are bypassed, writes are allowed, extra admin shortcuts appear (open Channels tab, open client settings). Every write records `createdById` as the admin, and sensitive actions go to the audit log.

`preview.start` and `preview.exit` are written to `AdminAuditLog`.

## 10. Admin console

New routes under `/admin` (layout with an `AdminGate`: non-admins are redirected to `/`):

| Route | Content |
|---|---|
| `/admin` | Cross-client overview: client count, channels needing attention (failed or disconnected), failed posts, posts due in 24h, newly invited users who have not accepted |
| `/admin/clients` | Table: client, status, channel icons, users, scheduled count, last activity. Search, filter by status, **New client** |
| New client dialog | Name and the main contact's email; shows the invite link to copy |
| `/admin/clients/[id]` | Header with name, status, **Preview as client**, Suspend or Activate. Tabs below |
| tab **Overview** | Counts, next posts, recent failures |
| tab **Channels** | Connect Instagram, Facebook, Threads (X later); list with status; Disconnect (soft); Reconnect |
| tab **Features** | Switch list grouped into Sections and Actions, each showing the default and the current value, with a note on what it hides |
| tab **Team** | Members, status, seats used of limit, resend invite, reset link, disable or enable |
| tab **Approvals** (phase 4) | Pending posts for this client |
| tab **Activity** | The audit log for this client |

Client app changes: `AppShell` builds the nav from `/auth/me` (role and features), hides Connections for clients, shows the agency-managed message where relevant, and `FeatureGate` wraps each section. Post-login redirect: admin goes to `/admin`, client goes to `/`. New `/accept-invite` and `/reset-password` pages. Overview and other pages must handle `FEATURE_DISABLED` for a single widget without breaking the page.

## 11. Approval workflow (optional phase 4)

- **Per client:** `Client.requireApproval`, or switch `schedule` off.
- **Flow:** a client user schedules, the post is saved with `approvalStatus=PENDING` and status `PENDING_APPROVAL`; the scheduler ignores it. Admins see a cross-client queue (`/admin/approvals`) and a per-client tab. **Approve** moves it to `SCHEDULED` (if its time has passed, the admin picks a new time). **Request changes** returns it to the client with a note; the client edits and resubmits. Editing an approved post sends it back to pending.
- In-app badges for counts (no email in this phase). Audit entries for every decision.

## 12. Background jobs and webhooks

| Job | Change |
|---|---|
| Scheduler (every minute) | Skip posts of `SUSPENDED` clients and disconnected accounts; skip posts awaiting approval |
| Insights sync (every 6h) | Keep syncing suspended clients (agency still wants the numbers); skip disconnected accounts |
| Meta token refresh (nightly) | No change |
| Autopilot ideas (daily 7am) | Per client brand profile; skip when the client is suspended or `ai` / `content-lab` is off |
| Pre-flight worker | Checks belong to the client; AI use needs `ai` |
| Comment automations (webhook) | Account to client; skip when suspended or `automations` is off |
| Uploads cleanup | Unchanged (it reads references from all tables) |

**Suspended client means:** the client's users cannot sign in (immediately), nothing is published, automations pause, analytics keep syncing, and admins can still preview and manage.

## 13. Media and file isolation

- **Now.** `/media/*` is public by URL because Meta fetches files at publish time. Names are `timestamp-8hex`, which is guessable in principle.
- **Phase 1:** write a `MediaFile` row on every upload. Validate that media attached to posts, drafts and checks belongs to the acting client, and make the pre-flight resolver (`resolveUpload`) reject other clients' files. This stops a client from referencing another client's file by name.
- **Hardening later:** lengthen the random part (change the upload name pattern, keep the old pattern readable), and consider short-lived signed URLs for anything not needing public access.

## 14. Migration and backfill (expand, backfill, contract)

0. **Back up** the database (`pg_dump`) and rehearse everything below on a restored copy first.
1. **Migration A (additive).** New enums, `Client`, `ClientFeatureFlag`, `AuthToken`, `AdminAuditLog`, `MediaFile`, new `User` columns, and **nullable** `clientId` columns on the six models. Nothing is removed.
2. **Backfill script** (idempotent, one transaction per existing user):
   - For each user without one: create a client named "<name>'s workspace" (AI switch on, as their account has always had it) and set it as the user's `clientId`. Roles are left alone; `ADMIN_EMAILS` promotes the named staff.
   - Set that `clientId` on the user's accounts, drafts, ideas, hooks, brand profile and checks.
   - Orphan accounts (`userId` null) go to the first user's client, matching today's rule.
   - Backfill `MediaFile` for existing upload files from the references in posts, drafts and checks (unreferenced files get no owner and are covered by the cleanup job).
   - Print counts before and after and fail on any row left without a `clientId`.
3. **Code cut-over** (phases 1 to 3). The new code writes `clientId` (and `createdById`); old `userId` columns stay populated for rows created before the cut-over.
4. **Migration B (contract), a week later.** Make `clientId` NOT NULL, add the final unique constraints (check for duplicates of `(provider, externalId)` first and resolve them by hand), then in a still later migration drop the old `userId` columns.
- **Rollback.** Before migration B: restore the pre-migration backup and the previous release. Rows created after cut-over would be lost on restore, so the cut-over should happen in a quiet window with a fresh backup.

The owner's day-to-day experience after migration is unchanged: they have a workspace holding their old data (and become an admin once listed in `ADMIN_EMAILS`). New clients are created from `/admin`.

## 15. File-by-file change list

**Backend (`backend/`)**
- `prisma/schema.prisma` and two migrations; `prisma/backfill-clients.ts`.
- New `src/tenancy/` (`ctx.ts`, `ctx.decorator.ts`, `scope.ts`, `features.constants.ts`, `features.service.ts`, `feature.guard.ts`, `roles.guard.ts`, `roles.decorator.ts`).
- `src/auth/auth.guard.ts` (context, status checks, act-as, read-only preview).
- `src/auth/users.controller.ts` (closed registration, login lockout, extended `/auth/me`); new `src/auth/invites.controller.ts` and `invites.service.ts`.
- New `src/admin/` module: `clients.controller.ts`, `team.controller.ts`, `features.controller.ts`, `audit.service.ts`, `admin-overview.controller.ts`.
- `src/accounts.controller.ts`, `src/auth.controller.ts` (state with clientId, admin-only start), `src/meta.service.ts` (`connect*` and `upsert` take the client; remove `/auth/exchange`).
- Scoped controllers and services converted from `userId` to client scope: `posts`, `drafts`, `comments`, `automations`, `dashboard`, `analytics` controllers; `ai/ideas`, `ai/hooks` (controller and service, including starter-hook seeding per client), brand profile; `preflight/preflight.controller` and `preflight.service` (28 touchpoints); `media.controller` (`MediaFile`).
- Jobs: `scheduler.service`, `insights.service`, `automations.service`, `ai/ideas.service` autopilot.
- `src/scripts/seed-demo.ts` (admin plus two clients plus client users).
- Tests: see section 16.

**Frontend (`frontend/`)**
- `lib/api.ts` (acting client headers; typed `FEATURE_DISABLED` and `PREVIEW_READ_ONLY` errors), new `lib/auth.tsx` (me context), `lib/features.ts`.
- `components/AppShell.tsx`, `components/CommandPalette.tsx` (nav by role and features), new `components/FeatureGate.tsx`, `components/preview/PreviewBar.tsx`, `ActingClientProvider.tsx`.
- `components/Composer.tsx` and `components/preflight/shared.tsx` (upload helpers use the shared header builder).
- `app/connect/page.tsx` (becomes the admin Channels tab content and a read-only client card), `app/page.tsx` and other pages (tolerate a switched-off widget).
- New `app/admin/**`, `app/accept-invite/page.tsx`, `app/reset-password/page.tsx`; login redirect by role.

## 16. Testing strategy

**Backend (extend the existing Jest and supertest suite, real Postgres)**
1. **Tenancy matrix (the safety net).** Build two clients with one of everything (account, draft, post, idea, hook, check, rule, comment). For **every** route that returns or changes tenant data, run: client A sees only A; client B sees only B; id-addressed routes with the other client's id answer 404; a client sending `X-Client-Id` of any client gets 403; admin with a header sees exactly that client; admin without a header sees home data. The route list is generated from the Nest router, and a test fails if a new route is not classified as tenant-scoped, public or admin-only.
2. **Authorization.** Clients cannot call `/admin/*`, connect, disconnect or add accounts; a member cannot invite; seat limits are enforced.
3. **Feature switches.** Default on; off gives 403 `FEATURE_DISABLED` for clients; admins bypass; unknown keys are rejected; background jobs respect switches.
4. **Invites and sessions.** Token is single-use, expires, is stored hashed, validate does not consume, resend invalidates the old one; disabled users and suspended clients are rejected immediately; password reset signs out old sessions; lockout works; registration is closed except bootstrap.
5. **Preview.** `X-Preview-Mode: view` blocks writes; audit entries are written; header from a client role is rejected.
6. **Migration.** Create old-shape data, run migration A and the backfill on a copy, assert every row has a `clientId`, counts match, the owner is an admin with a home client, and the backfill is idempotent.
7. **Jobs.** Scheduler skips suspended clients and pending approvals; autopilot and automations honour switches.
8. Update the existing tests that assume open registration or per-user ownership.

**Frontend (Vitest)**: nav by role and features; `FeatureGate` shows the friendly screen; `PreviewBar` shows and exits; `api()` adds headers and clears on sign-out; Connect hidden for clients; admin pages render with mocked data; widgets survive `FEATURE_DISABLED`.

**Manual and demo.** Extend the demo seed to an admin, two clients (for example Acme and Globex) with client users, then walk through: create client, copy invite, accept, connect a (fake) channel as admin, switch a feature off, preview as client in both modes, verify the client sees what was promised.

## 17. Security checklist

- No endpoint reads `userId` or `clientId` from the request body or URL to decide access; the effective client comes only from `Ctx`.
- Cross-client lookups answer 404; the act-as header is honoured only for admins; role comes from the database, never from the token.
- Invite and reset tokens: random, hashed, single use, short life, rate limited, never logged.
- Audit log for connect, disconnect, switch changes, invites, suspend, preview start, approvals.
- Admin actions made while previewing are attributed to the admin (`createdById`).
- CORS must allow the new `X-Client-Id` and `X-Preview-Mode` request headers (check, then add to the allowed list if the default does not reflect them).
- AI prompts only ever use the acting client's brand voice, recent titles and favourite hooks.
- Known existing risk (unchanged by this work, worth a separate task): the session token lives in `localStorage`.
- Log `clientId` and `actorId` on every request log line; never log tokens.

## 18. Phases, effort, and acceptance

| Phase | Work | Effort (engineer-days) | Depends on |
|---|---|---|---|
| 0 | Confirm decisions (section 20), backup, extend demo seed, record baseline (all backend tests pass) | 0.5 to 1 | none |
| 1.1 | Schema, migration A, backfill script, migration test | 2 | 0 |
| 1.2 | Request context, `AuthGuard` changes, `@Ctx`, scope helpers, roles and feature guards | 1.5 | 1.1 |
| 1.3 | Convert 16 backend files from user scope to client scope; `MediaFile` | 2.5 | 1.2 |
| 1.4 | Tenancy matrix test, update existing tests | 1 | 1.3 |
| 2.1 | Closed registration, invites, accept-invite, reset links, lockout, sessionVersion | 2 | 1.2 |
| 2.2 | Admin API: clients, suspend, seats, features, audit log | 1.5 | 1.3 |
| 2.3 | Admin-only connections, state with client, unique account rule, soft disconnect, remove `/auth/exchange` | 1.5 | 1.3 |
| 3.1 | Me context, nav gating, `FeatureGate`, role redirects | 1.5 | 2.1 |
| 3.2 | Acting client, `PreviewBar`, header injection, read-only mode | 1.5 | 3.1, 1.2 |
| 3.3 | Admin console pages and tabs | 3 | 2.2, 2.3 |
| 3.4 | Client read-only channels card, widget tolerance, accept-invite and reset pages | 1 | 3.1 |
| 4 (optional) | Approval workflow | 3 to 4 | 3.3 |
| 5 | Media ownership checks, docs and runbook, demo seed v2, cut-over rehearsal on a DB copy, full regression, CI | 2 to 3 | all |
| | **Core total** | **about 22 to 26** | |
| | With approvals | **about 25 to 30** | |

Critical path to the first demo (admin creates a client, invites, connects a channel, previews, switches a feature off): 0, 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3.

**Definition of done**
1. Every existing feature behaves as before for the migrated owner account.
2. Client A can never read or change client B's data (the tenancy matrix passes for every route).
3. A client cannot connect, disconnect or add channels, and cannot see Connections.
4. Admin can create a client, send an invite, connect channels, switch sections and actions, suspend and reactivate.
5. Admin can preview as a client in both modes, and read-only mode blocks writes on the server.
6. A switched-off section is unreachable by menu, typed address and API.
7. Registration is closed; all invite and reset flows work end to end.
8. All backend and frontend tests, lint and the production build pass in CI; migration rehearsed on a copy of real data.

## 19. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A missed filter leaks data between clients | Single `scope()` helper, generated route-coverage test, 404 for cross-client ids |
| Large cut-over breaks the owner's current workflow | Admin home client keeps the old experience; rehearse on a DB copy; backup; quiet window |
| Preview confusion (admin changes live client data) | Read-only default, yellow bar, audit trail |
| Meta access for client-owned assets | Verify App Review and Business verification needs early (external prerequisite) |
| No email service for invites | Copy-link flow now; email later |
| AI costs from client use | `ai` switch off by default for new clients |
| Scope creep from approvals | Isolated optional phase 4 |
| Feature lookup adds a query per request | Load flags with the context, memoize per request, small in-process cache with short TTL |
| Overlap with the X and provider refactor | Recommended order in section 0; both touch connect flows, so do not run them in parallel on the same files |

## 20. Decisions needed (with recommended defaults)

| # | Decision | Recommended default |
|---|---|---|
| 1 | Existing users get their own workspace; staff are named in `ADMIN_EMAILS` | Decided in Phase 1 (nobody is promoted automatically) |
| 2 | Client roles | POC now, members with seats in phase 2.1 |
| 3 | Can clients schedule directly | Yes by default, per-client switch, approvals in phase 4 |
| 4 | AI for clients | Off for new clients, you switch it on per client |
| 5 | Defaults for new sections and actions | On, except `ai` (as Cailyx: no row means on) |
| 6 | Preview default | Read only, server enforced |
| 7 | Suspended client | Blocks sign-in and publishing, keeps analytics sync |
| 8 | Invite delivery | Copy link now, email later |
| 9 | Same social account on two clients | Not allowed |
| 10 | Build the approval workflow now | Defer to phase 4 |

## Appendix A. API surface

**Changed:** `POST /auth/register` (bootstrap only), `GET /auth/me` (role, client, features), `GET /auth/:provider/start` (admin only, with client), `POST /accounts` and `DELETE /accounts/:id` (admin only; delete becomes soft disconnect), all tenant routes (scoped by client, switches enforced).
**New (auth):** `POST /auth/accept-invite/validate`, `POST /auth/accept-invite`, `POST /auth/reset-password/validate`, `POST /auth/reset-password`.
**New (admin, `ADMIN` only, answered 404 to others):** `GET /admin/overview`; `GET`/`POST /admin/clients`; `GET`/`PATCH /admin/clients/:id`; `POST /admin/clients/:id/suspend` and `/activate`; `PATCH /admin/clients/:id/seats`; `GET`/`PUT /admin/clients/:id/features`; `GET /admin/clients/:id/users`; `POST /admin/clients/:id/invite`; `POST /admin/users/:id/resend-invite`, `/reset-link`, `/disable`, `/enable`; `GET /admin/clients/:id/audit`; `GET /admin/clients/:id/channels`.
**New (client team):** `GET /team/members`, `POST /team/invite` (POC, within seats).
**Phase 4:** `GET /admin/approvals`, `POST /posts/:id/approve`, `POST /posts/:id/request-changes`, `POST /posts/:id/resubmit`.
**Error codes:** `FEATURE_DISABLED`, `CLIENT_SUSPENDED`, `ACCOUNT_DISABLED`, `CLIENT_REQUIRED`, `PREVIEW_READ_ONLY`, `SEAT_LIMIT`, `CHANNEL_ALREADY_CONNECTED`, `INVITE_INVALID`.
