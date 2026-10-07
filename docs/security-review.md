# Security review: client workspaces, invites, preview and uploads

Reviewed on branch `phase5-hardening` (built on `4361afe`), 2026-10-07. Scope: section 17 of `docs/admin-client-plan.md`,
plus the invite, reset, lockout, session, admin and preview surfaces added in Phases 1 and 2, and file uploads.

## Summary

| Result | Count |
|---|---|
| Verified (checked, nothing to change) | 38 |
| Fixed in this branch (with tests) | 6 |
| Gap (open, not fixed here) | 20 |

Most of the gaps are low risk. The ones to act on before a real launch are marked **act**:

1. **act** G1: `FRONTEND_URL` unset opens CORS to every origin, and a comma list breaks invite links (`main.ts`, `invites.service.ts`).
2. **act** G2: the bundled upload parser (`multer` 2.0.2 inside `@nestjs/platform-express`) has known denial-of-service advisories. Any signed-in person can reach it. Fix with an `overrides` entry (below).
3. **act** G3: with `ALLOW_SIGNUP=true`, anyone can register an address listed in `ADMIN_EMAILS` and become staff at the next start. Leave `ALLOW_SIGNUP` unset in production.
4. G4: a client's main contact can find out whether any email address has a Motion account, even in another client.
5. G5: nothing writes a log line per request or for a lockout, so "log clientId and actorId on every request" (plan 17) is not met and a lockout cannot be monitored.

What this branch fixed (all in code, all with tests in `backend/test/hardening.spec.ts`):

- Uploads were stored under an extension taken from the visitor's file name and checked only by the claimed type. An `.html` or `.svg`
  file labelled as a picture would have been served back from the API's own address. Now the extension comes from the checked type,
  the first bytes of the file must match it, and a failed file is removed.
- A media URL written with a percent-encoded name, a doubled slash or capital letters was not recognised as one of Motion's uploads, so
  it skipped the "this belongs to another client" check, and the nightly cleanup would not have counted it as in use. Both now read the name the way the file server does.
- Upload names had 32 random bits. New names have 128 (old names still work).
- A file whose ownership record could not be written stayed on disk with no owner. It is now removed.
- Upload is limited to 60 a minute per address, one file and a few fields per request.

How this was checked: code reading of every file named below, the generated route list in `test/tenancy.spec.ts`, 34 new tests
(`test/hardening.spec.ts`), and probes against a real running server (headers, CORS, media serving). The 7 pre-flight tests that need
ffmpeg do not run on the author's machine. Timing differences between sign-in answers were reasoned from the code, not measured.

## Table

Status: **verified**, **fixed**, **gap**. "Test" names are in `backend/test/hardening.spec.ts` unless a file is given.

### Plan section 17

| # | Item | Status | Evidence |
|---|---|---|---|
| 17.1 | No endpoint reads a client or user id from the body or URL to decide access; the client comes from `Ctx` only | verified | `grep` for `body.clientId`, `body.userId`, `query.clientId`: only `/admin/preview/start` and `/exit` read `body.clientId`, and they are staff only. Test "ignores any client or user id sent in a request body" (draft, post, brand profile). Admin routes take `:id` in the path by design and are staff only |
| 17.2 | Cross-client lookups answer 404; act-as only for staff; role from the database, never the token | verified | `auth/auth.guard.ts` loads role, status and client every request. Tests: "another client's ids are indistinguishable from ids that do not exist" (11 id routes, same status and message as a made-up id, and nothing of A's changed); "treats X-Client-Id the same wherever it points"; `tenancy.spec.ts` isolation and route-classification tests. Note: a client who sends `X-Client-Id` gets 403 `ACT_AS_FORBIDDEN` (the plan says so), the same answer for any target |
| 17.3 | Invite and reset tokens: random, hashed, single use, short life, rate limited, never logged | verified | Test "invite and reset links are 32 random bytes, stored only as a hash, and never logged or put in the audit log" (captures every logger call and `console.log`). Single use and expiry: `admin.spec.ts` "two people holding the same link", "answers every bad link the same way". Rate limit: test "rate limits the public invite, reset and sign-up routes" (10 a minute per address) |
| 17.4 | Audit log for connect, disconnect, switch changes, invites, suspend, preview start, approvals | gap | Written for all of these except approvals (stream C adds them). Not recorded: failed sign-ins, lockouts, `logout-all`, and content changes made in admin-controls preview (see 17.5, G9) |
| 17.5 | Admin actions while previewing are attributed to the admin | verified | Posts keep `createdById` of the admin; drafts and brand profile keep `userId` of the admin. Test "staff acting as the owner can use it" (`createdById`). Caveat G9: content edits are attributed but not written to the audit log |
| 17.6 | CORS allows `X-Client-Id` and `X-Preview-Mode` | verified | Real server on port 3115 with `FRONTEND_URL` set answered the preflight with `Access-Control-Allow-Headers: authorization,x-client-id,x-preview-mode` for the web app's origin and nothing for another origin. Test "CORS: a browser at the web app's address may send the act-as headers" runs the same `enableCors` call. The `cors` package reflects whatever headers are asked for |
| 17.7 | AI prompts only use the acting client's brand voice, recent titles and favourite hooks | verified | Read `ai/ideas.service.ts` (generate, autopilot per brand profile), `ai/hooks.service.ts`, `preflight/preflight.service.ts` (`brand(clientId)`, `history(clientId)` filter on `account.clientId`). No test inspects a prompt; `tenancy.spec.ts` "AI ideas and hooks are scoped" covers the data |
| 17.8 | Session token lives in `localStorage` (known, unchanged) | gap | **G7.** Accepted risk. Limits: 7 day life, `sessionVersion` ends all sessions on reset, disable or `logout-all`, helmet headers on the API |
| 17.9 | Log `clientId` and `actorId` on every request; never log tokens | gap | Tokens: verified (test above, plus `grep` of every `Logger` and `console` call: no token, link or password is logged). Request logging: **G5.** Nest logs no per-request line at all, so there is nothing to carry the ids |

### Public routes

The public routes are `POST /auth/login`, `/auth/register`, `/auth/accept-invite`, `/auth/accept-invite/validate`, `/auth/reset-password`,
`/auth/reset-password/validate`, `GET /auth/{facebook,instagram,threads}/callback`, `GET` and `POST /webhooks/meta`, and the `/media/*` files
(`test/tenancy.spec.ts` "nothing but the public routes answers without a session" proves every other route needs a session).

| # | Item | Status | Evidence |
|---|---|---|---|
| P1 | Sign-in, sign-up, invite and reset routes are rate limited | verified | `@Throttle(AUTH_LIMIT)`: 10 a minute per address. Tests "rate limits the public ..." and `api.spec.ts` "slows down repeated sign-in attempts". Needs `TRUST_PROXY` behind a proxy (G12) |
| P2 | OAuth callbacks and webhooks rate limit | verified | Callbacks use the global 600 a minute. The webhook is exempt on purpose and is verified by signature (P7) |
| P3 | `/media/*` files | gap | **G8.** Served by Express static outside Nest, so no throttle and no auth by design (Meta must fetch). Names are unguessable for new uploads (128 bits). Real server probe: directory listing 404, `..%2f` traversal 404, dotfile 404, correct content type, `nosniff`, `cross-origin` resource policy |
| P4 | Same answer for every failed sign-in | verified | Test "answers every failed sign-in the same way": unknown, wrong password, invited, disabled and locked give identical bodies |
| P5 | Timing does not tell whether an account exists | verified | `users.controller.ts`: unknown and password-less users are checked against a decoy hash, and the disabled and locked checks run after the password check. Reasoned from code, not measured |
| P6 | Invite and reset links: one answer for every bad link | verified | `invites.controller.ts` `invalid()`; `admin.spec.ts` "answers every bad link the same way" (wrong, expired, used, disabled owner) |
| P7 | Webhook signature | verified | `verifyMetaSignature` (HMAC-SHA256 over the raw bytes, `timingSafeEqual`), `api.spec.ts` webhook tests (missing or wrong signature gets 401). The one-time `hub.verify_token` compare is a plain `===` (not constant time). Minor, **G13** |
| P8 | Sign-up | verified | Closed unless `ALLOW_SIGNUP=true`; the closed answer (403) comes before any "email taken" check, so it reveals nothing (`admin.spec.ts` "is closed unless ALLOW_SIGNUP=true"). When open it does answer 409 "already exists" (expected for open sign-up) |
| P9 | Token entropy and storage | verified | 32 random bytes, base64url; only sha256 stored (`invites.service.ts`). Session tokens are HS256 with `AUTH_SECRET` of at least 32 characters, checked at boot (`assertSecurityConfig`) |
| P10 | Forged, altered, expired or wrong-purpose session tokens | verified | Test "refuses forged, tampered, expired and wrong-purpose tokens": alg `none`, swapped claims, damaged signature, expired, an OAuth state token, unknown user, garbage. The header is pinned to HS256 |
| P11 | Passwords | verified | scrypt with a 16 byte random salt, compared with `timingSafeEqual`; minimum 8 characters, no maximum (the 100 kb body limit bounds it). Test: no hash is ever returned ("never returns password hashes") |

### Invites, resets, lockout, sessions

| # | Item | Status | Evidence |
|---|---|---|---|
| S1 | A reset or disable ends older sessions; so does `logout-all` | verified | `sv` claim compared to `user.sessionVersion` on every request. `admin.spec.ts` "a reset link sets a new password and signs out every older session", "disabling someone ends their session at once", "sign out everywhere" |
| S2 | Suspended client and disabled user are refused on the next request | verified | `AuthGuard` reads both from the database each time. `admin.spec.ts` "pausing a client shuts its people out immediately", `tenancy.spec.ts` "disabled users and suspended workspaces are shut out immediately" |
| S3 | Lockout after 5 wrong passwords for 15 minutes | verified | `admin.spec.ts` "locks an account after five wrong passwords". Same answer as a wrong password. A reset link clears the lock (`redeem` sets `lockedUntil: null`) |
| S4 | Lockout counter | gap | **G6.** The count is read, then written, so many parallel guesses can slip past 5 before the lock lands. The 10 a minute address limit bounds it. A known email can also be locked out by someone else's wrong guesses (standard trade-off) |
| S5 | Invite redemption is atomic | verified | One conditional `updateMany` inside a transaction. `admin.spec.ts` "two people holding the same link cannot both use it" |
| S6 | A new link cancels the old one; disabling cancels all | verified | `issue()` and `revokeAll()`. `admin.spec.ts` "a new invitation cancels the old one" |
| S7 | Links are built from `FRONTEND_URL`, never from the request's `Host` header | verified | `invites.service.ts` `linkFor()`. No header-based link anywhere |
| S8 | `FRONTEND_URL` as a comma list, and unset | gap | **G1.** `main.ts` splits it by commas for CORS (without trimming) but `linkFor()` and the OAuth redirects use the whole string. A list makes broken links. Unset: CORS reflects every origin (`origin: true`) and OAuth redirects go to `undefined/connect` |
| S9 | First account on an empty database is staff | gap | **G10.** Two sign-ups at the very same moment on an empty database could both become admin (the count and the create are not one step). Only matters for the first minute of a new install |
| S10 | `ADMIN_EMAILS` promotion | gap | **G3.** Promotion happens at every start for any user with a listed address, with no proof that the person owns the address. Safe while sign-up is closed (a person only exists if staff invited them). Not safe with `ALLOW_SIGNUP=true` |

### Admin and preview

| # | Item | Status | Evidence |
|---|---|---|---|
| A1 | Every `/admin/*` route is staff only and looks absent to others | verified | `@Roles(ADMIN)` on the controller; `tenancy.spec.ts` "every staff route is closed to clients" runs all 22 and expects 404; route list is generated from the router, so a new unclassified route fails the suite |
| A2 | Read-only preview is enforced by the server | verified | `PREVIEW_READ_ONLY` for every non-GET with `X-Preview-Mode: view` while acting (`tenancy.spec.ts`). Test "a read-only preview cannot upload or attach anything" |
| A3 | Preview start and exit are audited | gap | **G9.** Recorded only when the web app calls `/admin/preview/start` and `/exit`. A staff member who sends `X-Client-Id` directly is not logged on first use. Staff are trusted; the log of changes is the safety net, but content edits are not in it |
| A4 | Archived clients cannot be acted on | verified | `AuthGuard` looks the target up with `archivedAt: null` (404). `admin.spec.ts` preview refusal for archived; test "treats X-Client-Id the same wherever it points" |
| A5 | Team routes cannot reach staff or the main contact | verified | `TeamService.find` limits roles; `admin.spec.ts` "the main contact invites and manages members; members and outsiders cannot" |
| A6 | A client's main contact can probe whether an email has an account | gap | **G4.** `POST /team/invite` answers 409 "That email already has an account." for any address in Motion, including another client's people. Fix: for client callers, answer the same success-shaped result or a neutral "could not invite this address" without saying why. Staff routes may keep the clear message |
| A7 | Seat limits | verified | `admin.spec.ts` "seat limits hold for invitations", "seats apply to the contact's invitations too" |

### Connecting channels (OAuth)

| # | Item | Status | Evidence |
|---|---|---|---|
| O1 | Only active staff can start or finish a connection, for a client that exists and is not archived | verified | `auth.controller.ts` `stateOwner()` re-checks role, status and client at the callback. `admin.spec.ts` "the redirect back only connects for staff who started it, to the client they chose" |
| O2 | State is signed, short lived and bound to the provider | verified | JWT type `oauth_state`, 10 minutes, `provider` compared. A session token is not accepted as a state, and a state is not accepted as a session (test "refuses forged ... tokens") |
| O3 | State is single use / bound to the browser | gap | **G11.** A state can be replayed for its 10 minutes. It also needs a valid Meta `code`, which is single use, so the practical risk is very low. The plan already lists single-use state with the X plan's `OAuthSession` |
| O4 | Stored tokens | verified | AES-256-GCM (`crypto.spec.ts`); API responses never include them (test "never returns password hashes" also checks `/accounts`); disconnect replaces the token (`admin.spec.ts` "disconnecting keeps the history, drops the token") |
| O5 | One channel, one client | verified | `assertChannelFree` plus the partial unique index; `admin.spec.ts` "one channel belongs to one client at a time". The "already connected to <name>" message is only ever shown to staff |

### Uploads and media

| # | Item | Status | Evidence |
|---|---|---|---|
| M1 | File type | fixed | Was: allow-list on the browser's claimed type only, and the stored extension came from the visitor's file name (so `x.html` or `x.svg` could be stored and served). Now: allow-list, extension chosen from the type, and the first bytes must match (JPEG, PNG, GIF, WebP, MP4, MOV). Tests "are named with a long random part and an extension chosen by Motion", "refuse files that are not what they claim to be, and leave nothing on disk", "recognise the start of each allowed type". Real server: an `evil.html` upload of PNG bytes was stored as `.png` and served as `image/png` with `nosniff` |
| M2 | File size | verified | 100 MB per file (`limits.fileSize`), one file, 5 fields, 8 parts per request. Read from the code; a real 100 MB upload was not sent |
| M3 | File name | fixed | Random part raised from 32 to 128 bits (`randomBytes(16)`), old names still accepted. Test "are named with a long random part" |
| M4 | Upload volume | fixed | 60 uploads a minute per address (was only the global 600). Test "are limited in how many one address can send a minute" |
| M5 | Failed upload leaves a file behind | fixed | A file that fails the content check, or whose ownership record cannot be written, is deleted. Test "leave nothing on disk" |
| M6 | A client cannot attach, publish with, or read another client's file | fixed | The check existed for plain `/media/<name>` URLs. It missed percent-encoded names (`/media/%31...`), `/media//name` and capital letters, which the file server still resolves. `upload-names.ts` now reads the last path segment, decoded and lower-cased, as the server does. Tests: "no other client can, whichever way the address is written" (post create, draft create, check create and compare), "nor can they swap it into a post or draft they already have", "does not show up in any list another client can read". Publishing reads only the URL stored on the post, and a post can never hold another client's file, so it cannot be sent with it (test "is still handed to the publisher only for the post that owns it") |
| M7 | Staff acting as a client use that client's files, and no other | verified | Tests "staff acting as the owner can use it, and staff acting as anyone else cannot", "are recorded with the client they were uploaded for" (client user, staff acting, staff at home) |
| M8 | Nobody can delete an upload through the API | verified | Test "cannot be deleted through the API by anyone" (DELETE and PUT answer 404 for client, other client and staff). Only the cleanup job deletes files |
| M9 | A read-only preview cannot upload | verified | Test "a read-only preview cannot upload or attach anything" |
| M10 | The nightly cleanup never removes a file any client still uses, and respects `UPLOAD_CLEANUP=on` | fixed | Its own name parser did not read encoded references; it now shares `uploadNamesIn`. Tests: "keeps every file any client's post, draft or check still uses, and removes only the unused one" (two clients, plus an encoded reference), "only reports unless UPLOAD_CLEANUP=on" (unset, `off`, `true`, `ON`), "does not touch a fresh upload"; `uploads-cleanup.spec.ts` |
| M11 | Uploads from before ownership was recorded have no owner and stay usable by anyone who knows the name | gap | **G14.** Deliberate (tested in `tenancy.spec.ts` "files from before ownership was recorded stay usable") so old drafts keep working. The backfill records every referenced file; only unreferenced old files are ownerless, and cleanup removes those after 14 days when switched on |
| M12 | Existence of a file name can be probed | gap | **G15.** Another client's file gives 400 where a made-up name is accepted (posts) or gives a different message (checks). With 128 bit names this cannot be guessed; the old 8 character names are guessable only with the exact upload time |
| M13 | Per-client storage limit | gap | **G16.** Nothing caps how much one client can upload (100 MB a file, 60 a minute per address). Add a per-client quota or a daily byte cap |
| M14 | Media link schemes | gap | **G17.** `mediaUrlList` accepts any string up to 2048 characters, so `javascript:` or `data:` links can be saved on a post. The web app only uses them as `src` values, which is inert, and Instagram rejects them at publish time. Fix: require `http` or `https` in `media-rules.ts` |
| M15 | Uploads need no feature switch (Phase 1 decision) | gap | **G18.** A client with `compose` and `preflight` both off can still upload files they cannot use. Harmless but takes disk until cleanup |

### Transport, headers, errors, logs

| # | Item | Status | Evidence |
|---|---|---|---|
| T1 | Security headers (helmet) | verified | `api.spec.ts` "sends security headers"; real server answer carried CSP, HSTS, `nosniff`, frame and referrer policies, no `X-Powered-By`. `Cross-Origin-Resource-Policy: cross-origin` on purpose (uploaded media is shown from another origin) |
| T2 | JSON body size | verified | Express default 100 kb: test "turns away a large JSON body" (413 on `/drafts` and `/auth/login`). Nothing raises the limit |
| T3 | Error responses do not leak internals | verified | Test "errors carry a short message and nothing about the server" (unknown route, malformed JSON, odd ids, missing sign-in): no stack, file path, library or database name. Nest returns "Internal server error" for unexpected failures |
| T4 | Errors that are the caller's fault log as server errors with a stack | gap | **G19.** An oversize or malformed body is logged at ERROR with a full stack trace (seen in the test output as `PayloadTooLargeError`). Anyone can fill the logs with them. Fix: an exception filter that logs 4xx at a lower level without the stack |
| T5 | Dependency advisories | gap | **G2.** `npm audit --omit=dev` reports 11 (3 high). The important one: `@nestjs/platform-express@10.4.22` carries its own `multer@2.0.2` (vulnerable up to 2.2.0: denial of service by resource exhaustion, incomplete cleanup, recursion), and it does the multipart parsing for `/media/upload`; the top-level `multer@2.4.0` is only used for `diskStorage`. Reachable by any signed-in person. Fix: add `"overrides": { "multer": "^2.4.0" }` to `backend/package.json`, run `npm install`, check the upload tests. Others (`lodash` via `@nestjs/config`, `uuid` via `@nestjs/schedule`, `file-type`, `qs`) need a Nest major upgrade and are not reachable from request input as far as read |
| T6 | Postgres published on the host with a default password (`docker-compose.yml`) | gap | **G20.** Fine on a developer machine. On a server, remove the `ports:` entry for `db` and change the password. The runbook says so |
| T7 | Rate limiting behind a proxy | gap | **G12.** Without `TRUST_PROXY`, every visitor behind ngrok or a proxy shares one address, so the 10 a minute sign-in limit locks everyone out together. Documented in the README and the runbook; the compose file does not set it |

## Gaps in one list

| ID | Risk | Gap | Suggested fix (file) |
|---|---|---|---|
| G1 | medium | `FRONTEND_URL` unset opens CORS; a comma list or spaces break links and redirects | Parse once (split, trim), use the first entry for links and redirects, require it at boot in production (`main.ts`, `invites.service.ts`, `auth.controller.ts`, `auth/crypto.ts`) |
| G2 | medium | Vulnerable `multer@2.0.2` inside `@nestjs/platform-express` | `overrides` entry (above) in `backend/package.json` |
| G3 | medium | `ADMIN_EMAILS` promotes an unverified self-registered address when `ALLOW_SIGNUP=true` | Keep `ALLOW_SIGNUP` unset in production; or promote only users who were invited (`status` set by an invite) (`tenancy/backfill.service.ts`) |
| G4 | low-medium | Main contact can test whether an email has an account | Neutral answer for client callers (`auth/invites.service.ts`, `team.controller.ts`) |
| G5 | low-medium | No request log line, no `clientId` or `actorId` in logs, no log for a lockout | A small interceptor that logs method, route, status, `clientId`, `actorId` (never headers or bodies), and one line when an account locks (`app.module.ts`, `users.controller.ts`) |
| G6 | low | Lockout counter is not atomic | Increment in the database in one statement (`users.controller.ts`) |
| G7 | low | Session token in `localStorage`, 7 days | Known; move to an httpOnly cookie later |
| G8 | low | `/media/*` has no rate limit | Put a limit at the proxy |
| G9 | low | Preview use and content edits in admin mode are not fully audited | Log the first use of an `X-Client-Id` per session and writes made while acting (`auth/auth.guard.ts`) |
| G10 | low | First-account race on an empty database | Take the same advisory lock the backfill uses around the first sign-up (`users.controller.ts`) |
| G11 | low | OAuth state can be replayed for 10 minutes | Single-use state table (already planned with the X work) |
| G12 | low | `TRUST_PROXY` not set in `docker-compose.yml` | Set `TRUST_PROXY=1` in `backend/.env` when behind one proxy |
| G13 | info | Webhook verify token compared with `===` | `timingSafeEqual` (`webhooks.controller.ts`) |
| G14 | low | Pre-ownership uploads with no owner are open to anyone who knows the name | Accepted; cleanup removes the unreferenced ones |
| G15 | info | File name existence can be probed | Make the two messages equal; names are long now |
| G16 | low | No per-client storage quota | Quota check in `media.controller.ts` |
| G17 | low | Media links may use any scheme | Allow only `http` and `https` (`media-rules.ts`) |
| G18 | info | Uploads need no switch | Allow upload only when `compose` or `preflight` is on |
| G19 | low | 4xx errors from body parsing are logged as errors with stacks | Exception filter (`configure-app.ts`) |
| G20 | ops | Compose publishes Postgres with the default password | Remove `ports` and set a password on a server |

(The counts at the top are rows of the tables above: 38 verified, 6 fixed, 20 gap. The 20 gaps are G1 to G20, one row each.)
