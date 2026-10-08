# Motion: X (Twitter) integration, research and architecture plan

Prepared 2026-10-06. Repo: `C:\Users\offic\OneDrive\Desktop\motion` (branch `main`, HEAD `69d64e7`). Read-only review: nothing in the repo was changed.

Tagging used for every X claim:
- **[V]**: verified on an official X page (docs.x.com raw Markdown, docs.x.com changelog, or an official X/devcommunity announcement). The date is given when the page shows one.
- **[V-snippet]**: an official page (help.x.com, devcommunity.x.com) that blocks direct fetching. The claim comes from the search-engine snippet of that official page, so treat it as strong but not first-hand.
- **[R]**: credible developer reports or third-party docs. Not confirmed by X.
- **[I]**: my inference.

---

## Executive summary

X now bills per call (**pay-per-use** is the only self-serve plan; legacy Basic/Pro were migrated by Jun/Sep 2026). Prices: **$0.015 per post, $0.20 per post containing a URL, $0.01 per "summoned" reply, $0.005 per post read, $0.01 per user read**. Real-time events (replies, mentions) are billed **$0.005 each** [V]. On 2026-02-23 X also restricted programmatic replies, @mentions and quotes on self-serve plans [V]. Quote posts now need Enterprise [V]. Motion's code is clean and well tested, but Meta knowledge is hard-coded in about 40 places. Several `else` branches **silently treat any unknown provider as Facebook**: token refresh, insights, post import. Adding a 4th provider row today would send X tokens to graph.facebook.com.

**Top 5 recommendations**
1. Do a small "fail-closed" provider-registry refactor first (2–3 days). Then build an X vertical slice (connect, then text/image post) behind a feature flag. That is the earliest demo, at about day 8. Finish the full abstraction after it.
2. Use OAuth 2.0 Authorization Code + PKCE (S256) only, as a confidential client. Scopes: `tweet.read tweet.write users.read media.write offline.access`. Store the encrypted refresh token, and make refresh single-flight under a Postgres advisory lock. Access tokens last 2 h and refresh tokens rotate.
3. Make "never publish twice" explicit: per-part state for threads, a reconcile-before-retry step for unknown outcomes, and a typed failure taxonomy shown to the user. X has no idempotency keys.
4. Ingest X replies and mentions through **X Activity API webhooks** (`post.reply.create`, `post.mention.create`, `oauth.revoke`), with a per-account spend cap. Keep a mentions-timeline poller only as the dev fallback.
5. Ship X automations as **public, templated replies to people who replied to or mentioned the account**, with 1 reply per interaction, cooldowns, caps and opt-out. On X: no keyword search triggers, no comment-to-DM, no AI auto-replies.

**Biggest risks:** policy and price changes at short notice (twice in 2026 already); link-post cost ($0.20 each); uncapped inbound-event cost for viral accounts; app-level suspension, which would cut off every Motion user's X at once; refresh-token races logging users out. A further unknown: X has not documented whether replying to a commenter on your own post always passes the new "summoned" gate.

---

## Part A. The current Meta integration

### A1. Architecture map

**Connect / OAuth**: `backend/src/auth.controller.ts`
- `GET /auth/:provider/start` (`start()`, l.48–94) is authenticated by the global `AuthGuard` (`auth/auth.guard.ts`). It allows only `facebook|instagram|threads` (l.50) and builds one of three authorize URLs by hand: `facebook.com/{v}/dialog/oauth`, `instagram.com/oauth/authorize`, `threads.net/oauth/authorize`. Scopes are constants `FB_SCOPES`, `IG_SCOPES`, `THREADS_SCOPES` (l.14–28). Redirect URIs come from `redirectFor()` (l.34–41), backed by `META_*_REDIRECT_URL`.
- `state` = `signToken(user.id, 'oauth_state', 600, { provider })`, an HS256 JWT signed with `AUTH_SECRET` (`auth/crypto.ts` `signToken`/`verifyToken`, l.45–64). It is stateless: it carries the user id and provider and has a 10-minute TTL. **It is not single-use**, so it can be replayed within 10 minutes.
- Three public callbacks (`fbCb`, `igCb`, `thCb`, l.113–152). Each one verifies state through `stateUser()`, calls `MetaService.connect*()`, then `done()` (l.103–107). `done()` fires `insights.syncAll()`, which syncs **every account of every user**, and redirects to `FRONTEND_URL/connect?connected=…`.
- `POST /auth/exchange` (l.155–188) exchanges a code and **returns the raw platform access token to the browser**. The frontend never uses it (grep: no caller).
- `MetaService` (`backend/src/meta.service.ts`):
  - `connectInstagram`: code, then short token, then `ig_exchange_token` (60 days), then `/me`, then `upsert`, then `subscribeInstagram`, then `importInstagramMedia` (25 posts).
  - `connectFacebook`: long-lived user token, then `/me/accounts`, then one `upsert` per Page (Page tokens, `tokenExpires=null`), then `subscribePage`.
  - `connectThreads`: `th_exchange_token`, then `/me`, then `importThreads`.
  - `upsert()` (l.303–329) is race-safe on `@@unique([userId, provider, externalId])` (P2002 handling).

**Token storage, encryption, refresh**
- `SocialAccount.accessToken` holds AES-256-GCM ciphertext `enc:v1:iv.tag.ct` (`auth/crypto.ts` `encryptToken`/`decryptToken`, l.68–94), keyed by `TOKEN_ENCRYPTION_KEY` (32 bytes). There is no AAD and no key id, so the key cannot be rotated. `assertSecurityConfig()` fails fast at boot. `MetaService.onModuleInit()` backfills plaintext tokens.
- Refresh: `MetaService.refreshExpiringTokens()` runs on `@Cron('0 4 * * *')` (l.332–376). It selects `tokenExpires < now+7d` and branches `instagram` → `ig_refresh_token`, `threads` → `th_refresh_token`, **else → `fb_exchange_token`**. Failures are only logged. No account status changes and the user is never told.
- There is no refresh-token column and no locking. The design assumes long-lived (60-day) tokens.

**Publish pipeline**
- `PostsController.create` (`posts.controller.ts`) validates platform/provider pairing through `PROVIDER_FOR` (l.8, l.35) and the IG JPEG rule (`media-rules.ts` `assertInstagramJpeg`). It stores `ScheduledPost` with status `SCHEDULED` and `mediaUrls` as a JSON string. It consumes the draft and marks the idea USED in one transaction. `PATCH` edits only while `SCHEDULED` (conditional `updateMany`, l.88).
- `SchedulerService.tick()` (`scheduler.service.ts`) runs every minute. It picks up to 10 due posts and claims each with `updateMany({where:{id,status:'SCHEDULED'}, data:{status:'PUBLISHING'}})`. Only claimed ids go to `PublishersService.publish()`. That conditional claim is the double-publish guard.
- `PublishersService.publish()` (`publishers.service.ts` l.25–40) dispatches on the `post.platform` string to `publishInstagram`, `publishFacebook` or `publishThreads`. Unknown platforms throw, so publish fails closed. On error it writes `FAILED` plus `error = JSON.stringify(e.response.data)`. **That raw provider JSON is shown to users** (`frontend/components/studio/PostDrawer.tsx` l.56). There is no retry, no backoff, and no recovery for posts stuck in `PUBLISHING` after a crash.
- IG/Threads containers are polled by `waitForContainer()` (waits 3s up to about 5 min, overridable `sleep()` for tests). The IG daily quota is pre-checked (`checkInstagramQuota`).
- Media hosting: `MediaController.upload` (`media.controller.ts`) writes to local `uploads/` (100 MB, JPG/PNG/WebP/GIF/MP4/MOV) and returns `${PUBLIC_BASE_URL}/media/<file>`. `main.ts` serves `/media/*` statically, and **Meta pulls the file by URL** at publish time. Pasted external URLs are passed straight to Meta. `UploadsCleanupService` cleans orphans nightly (dry-run by default).

**Webhooks and signature verification**: `webhooks.controller.ts`
- `GET /webhooks/meta` handles the hub.challenge handshake (`META_WEBHOOK_VERIFY_TOKEN`; plain `===` compare). `POST /webhooks/meta` is `@Public()` and `@SkipThrottle()`. It checks `X-Hub-Signature-256` against any of the three app secrets (`verifyMetaSignature`, timing-safe) over `rawBody` (`NestFactory.create(..., { rawBody: true })`).
- `commentsFromWebhook()` parses Page `feed` comment adds and IG `comments`. Messaging and Threads events are ignored.
- It replies 200 immediately and hands work to `AutomationsService.enqueue()`, an **in-memory** promise set. A crash after the 200 loses the event.

**Comment inbox**: `comments.controller.ts`
- `GET /comments/events` returns the last 100 `CommentEvent`s and joins them to published posts by `externalId`. Facebook `pageId_postId` tail matching happens at l.18–30.
- `POST /comments/reply` accepts Instagram or Facebook only (l.42). It handles provider checks, calls `replyInstagramComment`/`replyFacebookComment` or `privateReply*`, then marks `replied`/`dmSent`.

**Automations**: `automations.service.ts`, `automations.controller.ts`
- Rules: `COMMENT_KEYWORD | ALL_COMMENTS` × `PUBLIC | DM | PUBLIC_AND_DM`.
- `handleComment()` maps platform to provider (`PROVIDER_FOR`, IG/FB only). It finds accounts by `(provider, externalId=channelId)`, so tenants stay isolated. It skips own comments (`isOwnComment` checks id and username). It **claims** the comment by inserting `CommentEvent` (unique `accountId+commentId`) for exactly-once handling. The first matching rule wins. It replies publicly, records Motion's own reply id as handled, then sends the private reply unless the comment is more than 7 days old (`PRIVATE_REPLY_WINDOW_MS`).

**Analytics sync**: `insights.service.ts`
- `@Cron('15 */6 * * *')` → `syncAll()` (a shared in-flight promise). For each account, sequentially: `importPosts`, then `syncAccountInsights` (30-day backfill, last 2 days always re-fetched, followers snapshot), then `syncPostInsights` (50 posts within 90 days).
- Results are normalized into `AccountInsight(accountId,date,metric)` and `PostInsight(postId)`. Per-provider fetchers are `igDays`, `threadsDays`, `fbDays`, `igPost`, `threadsPost`, `fbPost`. Errors are concatenated into `SocialAccount.insightsError`. `AnalyticsController` reads only stored data.

**Data model**: `backend/prisma/schema.prisma`
- `SocialAccount(provider string, externalId, accessToken, tokenExpires, meta JSON-string, insightsSyncedAt, insightsError)` with unique `(userId,provider,externalId)`.
- `ScheduledPost(platform string, mediaType, caption, mediaUrls JSON-string, status, externalId, error, permalink)`. Note **`onDelete: Cascade`** from account.
- `PostInsight`, `AccountInsight`, `AutomationRule`, `CommentEvent(unique accountId+commentId)`.
- `ScheduledPost.platform` (`facebook`) and `SocialAccount.provider` (`facebook_page`) duplicate each other, with mapping tables spread over 3 files.

**Security controls**: global bearer-session guard; per-user scoping on every query; token encryption at rest; HMAC webhook verification; helmet; throttler (600/min global, 10/min auth; in-memory); the API never returns tokens (tested), except the `/auth/exchange` gap.

**Error handling / retry**: user-safe text through `MetaService.msg()`; the inbox and insights report per-step errors. Publishing has none: one attempt, then FAILED, and there is no "retry" action in the UI (`PATCH` only allows `SCHEDULED`).

**Tests**:
- `backend/test/api.spec.ts`: e2e against real Postgres with `PublishersService` mocked through `overrideProvider`. Covers auth, tenancy, webhooks, the inbox, drafts, scheduling claims and token encryption.
- `backend/test/meta-graph.spec.ts`: pins Graph URLs and params with `jest.mock('axios')`, and calls private methods such as `(pub as any).publishInstagram`.
- Also `crypto.spec.ts`, `preflight.spec.ts`, `uploads-cleanup.spec.ts`.
- Note: the owner reports 127 tests. My static count (it() plus 2 `it.each` over 43 routes) comes out higher. Run `npm test` once and record the baseline number before the refactor.

### A2. Honest strengths
- **Correct concurrency primitives in the right places**: the conditional-update claim in the scheduler, the conditional edit (`posts.controller.ts` l.88), insert-as-claim for webhooks (`CommentEvent`), race-safe `upsert`.
- **Security basics done properly**: AES-GCM with a fresh IV, timing-safe compares, raw-body HMAC, fail-fast config checks, strict tenant scoping with tests that try cross-tenant access.
- **Analytics decoupled from live API calls** (normalized tables plus a background sync). This maps well onto X's metered reads.
- **Pragmatic test seams**: an overridable `sleep()`, axios mocking that pins exact endpoints, and an e2e suite against real Postgres.
- Small, readable services; user-facing error copy is considered.

### A3. Honest weaknesses and where provider knowledge is hard-coded

**Hazards if a 4th provider row (`x`) appeared today, before any refactor:**

| Location | What happens to an `x` account |
|---|---|
| `meta.service.ts` l.357 `refreshExpiringTokens` else-branch | X tokens expire in 2 h, so every X account is selected nightly and **sent to `graph.facebook.com …fb_exchange_token`** |
| `insights.service.ts` l.104–108 `importPosts` | else → `importFacebookPosts` with the X token |
| `insights.service.ts` l.129–131 `syncAccountInsights` | else → `fbDays`/`fbFollowers` |
| `insights.service.ts` l.262–265 `syncPostInsights` | else → `fbPost` |
| `auth.controller.ts` l.103–107 `done()` | every connect triggers `syncAll()` across all tenants. Harmless on Meta, but **costs real money per call** on X |
| `frontend/lib/format.ts` l.5–13 `platformFor`/`platformName` | unknown provider **defaults to Instagram** (X accounts would render as Instagram with IG limits) |
| `frontend/app/connect/page.tsx` l.18–20 | same Instagram default for label, tone and icon |

**All hard-coded provider knowledge (to remove or centralize):**
- Backend allow-lists and mapping tables:
  - `accounts.controller.ts` l.6 `PROVIDERS`
  - `posts.controller.ts` l.6–8 `PLATFORMS`, `PROVIDER_FOR`, plus the l.35 ternary for display names
  - `drafts.controller.ts` l.6–7
  - `automations.service.ts` l.7
  - `comments.controller.ts` l.42–62
  - `ai/ai.service.ts` l.10 `PLATFORMS` (also used by `preflight.service.ts` l.82–83)
  - `BrandProfile.platforms` default
- Auth: `auth.controller.ts` scope constants, `redirectFor`, the provider guard at l.50, three per-provider URL builders, three callbacks, the `exchange` branches.
- Publishing: `publishers.service.ts` dispatch (l.32–35), plus reply/hide/privateReply helpers named per platform.
- Media rules: `meta-config.ts` (`NON_JPEG_IMAGE`, `VIDEO_URL`, `PRIVATE_REPLY_WINDOW_MS`), `media-rules.ts` (`MAX_MEDIA=10` because of IG carousels; `assertInstagramJpeg`), `media.controller.ts` (allowed MIME types, 100 MB, URL-pull model through `PUBLIC_BASE_URL`).
- Webhooks: path `webhooks/meta`, `webhookSecrets()`, Meta envelope parsing in `commentsFromWebhook`.
- Schema comments and enums as strings: `provider`, `platform`, `mediaType` (`REELS|STORIES|CAROUSEL`), `replyMode` (`DM` assumes private replies exist).
- Frontend:
  - `lib/format.ts` (`Platform` union, `FORMATS_BY_PLATFORM`)
  - `components/Composer.tsx` (`CAPTION_LIMIT` l.21, IG-specific auto-switch to REELS l.222, accepted MIME list l.304, preview tabs l.350, per-platform notes l.366, plain `caption.length` counting)
  - `components/studio/PhonePreview.tsx` (clip lengths and ratios l.9–22)
  - `app/comments/page.tsx` (`REPLY_LIMIT=500`, Threads exclusions l.60/71, DM checkbox copy "within 7 days")
  - `app/automations/page.tsx` (DM modes)
  - `app/planner/page.tsx` (filter options l.179, IG feed preview)
  - `app/connect/page.tsx` (cards, "Approve on Meta", "Opening Meta…")
  - `components/Icons.tsx` l.26–28/67–69, `app/globals.css` l.383–385
  - `app/lab/page.tsx` l.18/163, `components/lab/BrandSheet.tsx` l.12, `components/lab/HooksView.tsx` l.20, `components/preflight/shared.tsx` l.47, `components/CommandPalette.tsx` l.27

**Other weaknesses (they matter more once a metered, stricter platform is added):**
1. **Disconnect deletes history.** `DELETE /accounts/:id` cascades to every post, insight, rule and comment (`onDelete: Cascade`). The UI copy says posts "will stop publishing until you connect it again" (`connect/page.tsx` l.61), which is false. Disconnect also does not revoke the token at the provider or unsubscribe webhooks.
2. **No account health state.** Refresh failures only produce a log line. The Connect page always shows "Connected" and "Tokens refresh automatically".
3. **Publishing has no retry or reaper, and raw JSON errors reach users.** The scheduler takes 10 posts per minute, so a 9:00 spike across many accounts queues up.
4. **Webhook work is not durable** (in-memory `enqueue`). Throttler and crons are per process, so running 2+ backend replicas duplicates insights and refresh crons. Publish is still protected by the claim.
5. Stateless OAuth state is replayable for 10 minutes, and there is no place to keep a PKCE verifier.
6. `/auth/exchange` leaks platform tokens to the browser and has no caller.
7. Validation lives in controllers (IG JPEG) rather than per provider. The composer and the backend duplicate the limits.
8. Uploads sit on local disk, which ties the app to a single instance.

### A4. Proposed provider abstraction (designed from what the code does today)

Module layout:
- `backend/src/providers/` holds `types.ts`, `registry.ts`, `errors.ts`, `token.service.ts`, `http.ts`.
- `backend/src/providers/meta/` holds a shared `MetaGraphClient` plus `instagram.provider.ts`, `facebook.provider.ts` and `threads.provider.ts`, created by moving code out of `meta.service.ts`, `publishers.service.ts` and `insights.service.ts`.
- `backend/src/providers/x/` holds `x.provider.ts`, `x.client.ts`, `x.media.ts`, `x.webhooks.ts`.

```ts
// providers/types.ts  (sketch: names map to today's functions)
export type ProviderId = 'instagram' | 'facebook_page' | 'threads' | 'x';

export interface TokenSet { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; scopes?: string[] }
export interface ConnectedIdentity {           // FB returns many (Pages), others one
  externalId: string; name: string | null; username?: string;
  tokens: TokenSet; meta?: Record<string, unknown>;
  limits?: Partial<AccountLimits>;             // e.g. X Premium -> longer text
}
export interface CallContext {                 // what every adapter call receives
  account: AccountView;                        // no plaintext token inside
  accessToken(): Promise<string>;              // refresh-aware (TokenService)
  http: ProviderHttp;                          // axios instance: timeouts, redaction, rate-header capture, cost ledger
  sleep(ms: number): Promise<void>;            // keeps today's test seam
}

export interface AuthAdapter {                 // replaces auth.controller branches + MetaService.connect*
  pkce: boolean;
  authorizeUrl(i: { state: string; redirectUri: string; codeChallenge?: string; scopes: string[] }): string;
  exchange(i: { code: string; redirectUri: string; codeVerifier?: string }): Promise<ConnectedIdentity[]>;
  refreshPolicy: { mode: 'none' | 'extend-long-lived' | 'rotating-refresh-token'; refreshAheadMs: number; keepAliveDays?: number };
  refresh?(current: TokenSet, account: AccountView): Promise<TokenSet>;   // throws ProviderError(AUTH_*)
  revoke?(t: TokenSet): Promise<void>;
  afterConnect?(ctx: CallContext): Promise<void>;     // subscribePage / subscribeInstagram / XAA subscriptions
  beforeDisconnect?(ctx: CallContext): Promise<void>;
}

export interface Capabilities {                // served to the frontend via GET /providers
  formats: MediaKind[];                        // TEXT|IMAGE|VIDEO|GIF|REELS|STORIES|CAROUSEL|THREAD|POLL
  text: { max: number; premiumMax?: number; counter: 'utf16' | 'graphemes' | 'x-weighted'; previewClip: number };
  media: { delivery: 'public-url' | 'upload-bytes'; maxItems: number; mixImageVideo: boolean;
           image: { mimes: string[]; maxBytes: number }; gif?: { maxBytes: number };
           video: { mimes: string[]; maxBytes: number; maxSeconds: number }; altText?: { max: number } };
  publish: { nativeSchedule: boolean; threads: boolean; polls: boolean; replySettings?: string[]; quote: boolean; edit: 'none' | 'premium-1h' };
  inbox: { comments: boolean; mentions: boolean; dms: boolean; realtime: 'webhook' | 'poll' | 'none' };
  engagement: { publicReply: boolean; privateReplyFromComment: boolean; hide: boolean; replyGate?: 'summoned' };
  automation: { triggers: ('OWN_POST_REPLIES' | 'MENTIONS' | 'KEYWORD_SEARCH')[]; dm: boolean; aiReplies: 'allowed' | 'needs-approval' | 'forbidden'; maxRepliesPerInteraction: number };
  analytics: { accountDaily: 'native' | 'derived' | 'none'; postMetrics: boolean; privateMetricsWindowDays?: number };
  metered: boolean;                            // X: every call costs money
}

export interface PublishAdapter {
  validate(d: PostDraftInput, a: AccountView): ValidationIssue[];        // same code for composer preview API and POST /posts
  publish(job: PublishJob, ctx: CallContext): Promise<PublishResult>;    // job carries parts[] with per-part externalId for resume
  reconcile?(job: PublishJob, ctx: CallContext): Promise<PublishResult | null>; // "did it actually post?"
  delete?(externalId: string, ctx: CallContext): Promise<void>;
}
export interface InboxAdapter {
  webhook?: { handshake(req: RawReq): { status: number; body: unknown } | null;
              verify(raw: Buffer, headers: Record<string, string>): boolean;
              parse(body: unknown): InboundInteraction[] };
  poll?(ctx: CallContext, cursor?: string): Promise<{ items: InboundInteraction[]; cursor?: string }>;
}
export interface EngagementAdapter {
  reply(ctx: CallContext, targetId: string, text: string): Promise<{ externalId: string }>;
  privateReply?(ctx: CallContext, targetId: string, text: string): Promise<void>;
  hide?(ctx: CallContext, targetId: string, hidden: boolean): Promise<void>;
}
export interface InsightsAdapter {
  importRecent?(ctx: CallContext): Promise<ImportedPost[]>;              // importInstagramMedia / importThreads / importFacebookPosts
  accountDaily?(ctx: CallContext, days: number[]): Promise<DayValues>;   // igDays / threadsDays / fbDays
  followers?(ctx: CallContext): Promise<number | null>;
  postMetrics(ctx: CallContext, externalIds: string[]): Promise<Map<string, PostMetrics>>; // batched (X: 100 ids/call)
  cadence: { postAgesHours: number[]; accountEveryHours: number };      // X: decaying schedule to save money
}
export interface RatePolicy {
  bucketFor(op: OpKey): { key: string; scope: 'user' | 'app' };
  observe(op: OpKey, status: number, headers: Record<string, string>): RateUpdate | null;  // x-rate-limit-*
  costUsd?(op: OpKey, units: number): number;                                                // feeds the spend ledger and caps
}
export type ErrorCode =
  | 'AUTH_EXPIRED' | 'AUTH_REVOKED' | 'PERMISSION_MISSING'
  | 'RATE_LIMITED' | 'ACCOUNT_LIMIT' | 'BILLING_EXHAUSTED'
  | 'VALIDATION' | 'MEDIA_REJECTED' | 'DUPLICATE' | 'POLICY_BLOCKED'
  | 'NOT_FOUND' | 'TRANSIENT' | 'UNKNOWN_OUTCOME' | 'UNKNOWN';
export class ProviderError extends Error {
  constructor(public code: ErrorCode, public userMessage: string,
              public opts: { retryable: boolean; retryAt?: Date; httpStatus?: number; providerCode?: string; detail?: string } ) { super(userMessage); }
}
export interface SocialProvider {
  id: ProviderId; platform: string; displayName: string; capabilities: Capabilities;
  auth: AuthAdapter; publisher: PublishAdapter; inbox?: InboxAdapter; engagement?: EngagementAdapter;
  insights?: InsightsAdapter; rate: RatePolicy; mapError(e: unknown): ProviderError;
}
```

Registry rules: `registry.get(id)` **throws for unknown ids** (fail closed). Every cron iterates `registry.forAccount(a)` and skips providers that don't implement a capability, instead of using an `else` branch. `platform` vs `provider` is resolved in exactly one place (`provider.platform`). `GET /providers` returns `{id, platform, displayName, capabilities, enabled}` for the frontend.

**Low-risk refactor sequence (each step is its own PR; the suite stays green throughout):**
0. **Baseline and golden tests.** Record the test count. Add "golden request" tests that capture every axios call (url, params, body) for each Meta flow: 3 connects, 6 publish shapes, 3 refreshes, 3 insights syncs, reply/hide/privateReply, webhook parse. They run against the current code and are stored as Jest snapshots. Add a hazard test: "an account with provider `x` is never sent to graph.facebook.com by refresh or insights" (it fails today, which proves the gap).
1. **Fail-closed registry, behaviour-neutral.** Introduce `types.ts` and `registry.ts` with Meta adapters that **delegate to the existing methods**. Replace the four `else` dispatches (`refreshExpiringTokens`, `importPosts`, `syncAccountInsights`, `syncPostInsights`) and `PublishersService.publish`'s if-chain with registry lookups. Keep `PublishersService`'s public method names (api.spec mocks them) and the private methods `meta-graph.spec` calls. Golden tests prove identical calls, and the hazard test turns green.
2. **Token service.** Move `encryptToken`/`decryptToken` use and the nightly refresh into `TokenService` with `refreshPolicy`. Move `onModuleInit` backfill there. Add the `status` column (see D3). Golden refresh tests stay identical.
3. **Capabilities as data.** Move the caption limits, formats, `MAX_MEDIA`, the JPEG rule and the reply limit into `capabilities`. `PostsController`/`DraftsController` call `publisher.validate()`. The frontend reads `GET /providers`, with `format.ts` keeping a static fallback. Update `Composer.test.tsx` expectations only where copy changes.
4. **Generic auth routes.** `GET /auth/:provider/start` and `GET /auth/:provider/callback` dispatch to `auth`. Keep the old paths (`/auth/instagram/callback` etc.) as the same handlers so the registered Meta redirect URIs keep working. Delete `/auth/exchange`, and update the protected-routes list in api.spec in the same PR.
5. **Error taxonomy.** Add `ScheduledPost.errorCode` and a user message, and map Meta errors (OAuth 190 → AUTH_EXPIRED, 4/17/32/613 → RATE_LIMITED, 9007/2207xxx → MEDIA_REJECTED, etc.). Keep the raw text in logs only.
6. **Webhooks per provider.** `/webhooks/:provider` with `inbox.webhook.verify/parse`, keeping `/webhooks/meta`. Then a durable `InboundEvent` table drained by a worker, replacing in-memory `enqueue` (api.spec's `AutomationsService.idle()` keeps working if the worker exposes `idle()`).
7. Only after that, move Meta code physically into `providers/meta/*` and update `meta-graph.spec` imports (mechanical).

---

## Part B. X API research (as of 2026-10-06)

### B1. Access tiers and pricing
| Fact | Status |
|---|---|
| Self-serve access is **pay-per-use** credits bought in the Developer Console (console.x.com). No subscription and no minimum. Spend limits and auto-recharge are available (one top-up per 5 min). The balance can go slightly negative, and then requests are blocked. | [V] docs.x.com pricing page (no date shown) |
| Launched 2026-02-06. Recently active legacy Free users got a one-time $10 voucher. Public Utility apps keep free access. | [V] changelog 2026-02-06 |
| Legacy **Basic** auto-migrated to PPU after 2026-06-01. Legacy **Pro** auto-migrated after 2026-09-01. | [V-snippet] devcommunity announcements 266305, 273255 |
| Reads (per resource returned): Post $0.005, User $0.010, DM event $0.010, Followers/Following $0.010, Like/Mute/Block $0.001 | [V] pricing |
| Writes (per request): Post create **$0.015**, post with URL **$0.20**, **summoned post $0.010**, DM create $0.015, user interaction $0.015, interaction delete $0.010, content manage $0.005, media metadata $0.005 | [V] pricing; changelog 2026-04-16 (effective 2026-04-20) |
| Your own domain counts as a URL; replies with URLs bill at $0.20 | [R] (opentweet, gigazine reporting the announcement) |
| **Owned Reads $0.001** apply only when `{id}` is the authenticated user **and that user owns the developer app**. Motion's customers do **not** qualify; only Motion's own brand account does. | [V] pricing |
| Deduplication: the same resource is billed once per UTC day (a "soft guarantee") | [V] pricing |
| Only successful responses that return data are billed | [V] docs "Usage and Billing" FAQ |
| Cap: **3M post reads per monthly cycle** on PPU, above that Enterprise | [V] pricing |
| XAA webhook events are billed per delivered event: `post.create`/reply/mention/quote/repost **$0.005**, `dm.received` $0.010, `post.delete`/`dm.sent` not billed | [V] pricing + XAA intro |
| Free credits: $20 when you save a first card plus a match of the first auto-recharge up to $50; they expire after 3 months | [V] changelog 2026-10-02 |
| xAI credit rebate of 10–20% above $200/$500/$1,000 cycle spend | [V] pricing |
| Media upload (init/append/finalize) price | **Not listed** in the pricing table [V absence]. Confirm in the console. |
| `GET /2/tweets/analytics` price | Not listed. Confirm. |
| Enterprise starts at "~$42k/month" | [R] only |
| Free tier only for "non-commercial" use; commercial use needs a paid tier | [V] docs Developer Guidelines |

**Minimum tier per capability:** everything Motion needs (OAuth 2.0 user context, post create/delete, v2 media upload, mentions timeline, recent search, post lookup with metrics, `GET /2/tweets/analytics`, XAA webhooks, DMs, hide replies, batch compliance) is available on **pay-per-use** [V, endpoint docs list PPU/self-serve]. These are not available on self-serve: **quote posts** (Enterprise only) [V create-post page; changelog 2026-04-16], programmatic Likes/Follows (removed from self-serve) [V], compliance streams (Enterprise) [V], and unrestricted replies, @mentions or quotes (Enterprise unaffected by the 2026-02-23 restriction) [V].

### B2. Authentication
- **OAuth 2.0 Authorization Code with PKCE**: authorize at `https://x.com/i/oauth2/authorize`, token at `POST https://api.x.com/2/oauth2/token`, revoke at `POST https://api.x.com/2/oauth2/revoke`. Confidential clients (Web App / Automated App) authenticate with `Authorization: Basic base64(client_id:client_secret)`. `code_challenge_method` is `S256` or `plain`. `state` may be up to 500 chars. **The authorization code expires 30 s** after approval. Redirect URIs must match exactly (no wildcards) [V docs "Authorization Code Flow with PKCE", "user-access-token"].
- **Access tokens last 2 hours** (`expires_in` 7200). A refresh token is issued only with **`offline.access`** [V].
- **Refresh tokens rotate.** Each refresh returns a new refresh token and the old one stops working ("Value passed for the token was invalid"). Reported lifetime is about 6 months [R, devcommunity threads; official docs say neither]. Design for single-use rotation.
- Grant types: authorization_code, refresh_token, and (since 2026-09-21) token-exchange from OAuth 1.0a without re-consent [V changelog].
- **OAuth 1.0a** is not needed. Every endpoint Motion would use accepts `OAuth2UserToken`, including v2 media upload (`media.write`) [V OpenAPI security blocks]. Webhook management (`/2/webhooks`) and XAA admin use the **app-only Bearer token** [V].
- Scopes [V list]: `tweet.read`, `tweet.write`, `tweet.moderate.write` (hide replies), `users.read`, `users.email`, `follows.*`, `offline.access`, `like.*`, `list.*`, `block.*`, `mute.*`, `bookmark.*`, `dm.read`, `dm.write`, `media.write`, `space.read`, `broadcast.*`.
  - **Least privilege for Motion v1:** `tweet.read tweet.write users.read media.write offline.access`. Add `tweet.moderate.write` only if "hide reply" ships, and `dm.read dm.write` only if DMs ship (not recommended for v1).
  - Create and delete need `tweet.read tweet.write users.read`. Media needs `media.write`. XAA private reply and mention events need `tweet.read` [V].
- Callback URL rules: up to 10 per app, https in prod, **local dev must use `http://127.0.0.1`, not `localhost`** [V docs "Developer Apps"]. Motion's `.env.example` uses `localhost` for Meta, so X needs `http://127.0.0.1:3001/auth/x/callback` in dev.
- Users can revoke in X settings. XAA emits **`oauth.revoke`** [V].
- Rate limit difference: OAuth 2.0 raises post and user lookup limits [V].

### B3. Creating posts (`POST /2/tweets`) [V create-post page unless noted]
- Fields: `text`, `media{media_ids (1–4), tagged_user_ids ≤10, …}`, `poll{options 2–4 × 1–25 chars, duration_minutes 5–10080}`, `reply{in_reply_to_tweet_id, exclude_reply_user_ids}`, `reply_settings` (`following|mentionedUsers|subscribers|verified`), `quote_tweet_id` (**Enterprise only**), `for_super_followers_only`, `geo.place_id`, `community_id` (plus `share_with_followers`), `nullcast`, `paid_partnership` (2026-06-03), `made_with_ai`, `edit_options.previous_post_id` (edit: **X Premium only, own post, within 1 hour**, changelog 2025-10-03). The response is `{data:{id,text,edit_history_tweet_ids}}`.
- **Text length: 280 weighted characters.** Most characters count 1; emoji, CJK and "other Unicode" count 2; any URL counts 23 (t.co); auto-populated reply @mentions don't count; text is NFC-normalized; use `twitter-text` to count [V "Counting Characters"]. Premium long posts up to 25,000 characters are possible via the API [R, Ayrshare docs; not on docs.x.com]. `users/me` returns `subscription_type` (`Basic|Premium|PremiumPlus|None`) [V OpenAPI], which can gate the limit.
- **Threads (chains):** post part 1, then each next part as `reply.in_reply_to_tweet_id = previous id`. Replying to your own posts is allowed under the 2026 restriction [V-snippet devcommunity staff; R several tools] [I: still test].
- **Reply restriction (2026-02-23):** "Programmatic replies via `POST /2/tweets` are now only permitted when the original Post's author has 'summoned' the replier (by @mentioning that account or quoting one of its Posts). Additional restrictions apply to programmatically @mentioning or quoting users." It applies to self-serve; Enterprise is not affected [V changelog]. Free, Basic, Pro and PPU are all covered; Public Utility apps are exempt [V-snippet @XDevelopers].
  - Rejected replies return 403 "Reply to this conversation is not allowed because you have not been mentioned or otherwise engaged by the author of the post you are replying to" [R].
  - **@mentions in normal posts:** you may only @mention or quote users "already involved in any ongoing context", and developers report standalone posts with @mentions being blocked [V-snippet devcommunity announcement/thread 258399]. **For a scheduler this means a post that @mentions a partner can fail.**
- Polls with media: not combinable [I, from X app behaviour; not stated on the page].

### B4. Media upload [V unless noted]
- v2 endpoints:
  - `POST /2/media/upload` is one-shot, **images and subtitles only**.
  - The chunked flow is `POST /2/media/upload/initialize` (`media_type`, `total_bytes` ≤16 GB, `media_category`), then `POST /2/media/upload/{id}/append` (`segment_index`, ≤5 MB per chunk), then `POST /2/media/upload/{id}/finalize`, then poll `GET /2/media/upload?command=STATUS&media_id=` honouring `processing_info.state` (`pending|in_progress|succeeded|failed`) and `check_after_secs`.
  - Do **not** send `command=INIT/APPEND/FINALIZE` to `POST /2/media/upload` any more.
  - `media_id` expires 24 h after init (`expires_after_secs: 86400`).
  - Sources: docs "Chunked Media Upload"; changelog 2026-09-01.
- **v1.1 media upload (`upload.twitter.com`) was sunset on 2025-06-09** [V-snippet devcommunity "Media Upload Endpoints Update"; changelog Jan/Apr 2025 for the v2 launch].
- Limits follow the **posting user's** Premium status, not the API plan, and are enforced at upload and again at post create (separately):
  - images JPG/PNG/GIF/WEBP ≤5 MB
  - GIF ≤15 MB (≤1280×1080, ≤350 frames)
  - video `tweet_video` 0.5 s–20 min / 8 GB default, 125 min / 16 GB Premium
  - DM video 140 s / 512 MB
  - A post holds up to **4 photos, or 1 GIF, or 1 video**.
  - A duration violation returns 403 "This user is not allowed to post a video longer than N minutes" [V "Best practices"; changelog 2026-09-01].
- Video recommendations: H.264 High, AAC-LC (not HE-AAC), ≤60 fps, YUV 4:2:0, no open GOP, progressive, aspect 1:3–3:1, 1:1 pixel aspect. The page also lists "dimensions between 32×32 and 1280×1024" while saying subscribers can upload 1080p. **That is internally inconsistent; transcode to a safe profile** [V page; I on handling].
- **Alt text:** `POST /2/media/metadata` with `alt_text.text` ≤1000 chars, scope `media.write`, billed "Media Metadata" $0.005 [V].
- X **does not pull media from URLs**; the server must upload bytes [V by API shape]. Motion's `PUBLIC_BASE_URL` model does not apply to X.

### B5. Scheduling, deletion, idempotency
- **No native scheduling** exists in the X API v2 for organic posts; the docs index has no schedule endpoint [V absence]. Motion must schedule itself, as it already does.
- Delete: `DELETE /2/tweets/:id`, scope `tweet.write`, 50 per 15 min per user [V]. Price is probably "Interaction: Delete $0.010" [I mapping].
- **No idempotency key** on `POST /2/tweets` [V absence]. X rejects identical text recently posted by the same account with a 403 "not allowed to create a Tweet with duplicate content" [R, Ayrshare and others; the window is not documented]. Do **not** adopt the "insert a zero-width space and retry" trick that vendors suggest: it defeats a spam control [I].
- Posting identical or substantially similar content across multiple accounts is prohibited [V Developer Guidelines; Restricted Use Cases].

### B6. Rate limits [V docs "X API Rate Limits"]
- Headers: `x-rate-limit-limit`, `x-rate-limit-remaining`, `x-rate-limit-reset` (epoch). A 429 means waiting until reset with backoff. Per-user limits apply with user tokens; per-app limits apply with the app Bearer token.

| Endpoint | Per app | Per user |
|---|---|---|
| `POST /2/tweets` | **10,000/24h** | **100/15min** |
| `DELETE /2/tweets/:id` | — | 50/15min |
| `GET /2/tweets` (lookup, ≤100 ids) | 3,500/15min | 5,000/15min |
| `GET /2/users/:id/tweets` | 10,000/15min | 900/15min |
| `GET /2/users/:id/mentions` | 450/15min | 300/15min |
| `GET /2/tweets/search/recent` | 450/15min | 300/15min |
| `GET /2/users/me` | — | 75/15min |
| `GET /2/tweets/analytics` | 300/15min | 300/15min |
| media initialize/append/finalize | 180,000/24h | 1,875/15min |
| `POST /2/media/metadata` | 50,000/24h | 500/15min |
| DM send | 1,440/24h | 15/15min, 1,440/24h |
| `PUT /2/tweets/:id/hidden` | — | 50/15min |
| XAA subscriptions CRUD | 500/15min | — |

- **The app-wide 10,000 posts per 24 h** becomes Motion's ceiling at about 2,000 accounts × 5 posts/day [I arithmetic].
- Account limits (all clients combined): 2,400 posts/day split into semi-hourly windows; **unverified accounts: 50 original posts and 200 replies per day**; DMs 500/day [V-snippet help.x.com "About X limits"].
- Extra 24-hour headers on `POST /2/tweets` (`x-user-limit-24hour-*`, `x-app-limit-24hour-*`) are reported by developers but not documented [R]. Parse them if present.

### B7. Reading mentions, replies, conversations
- `GET /2/users/:id/mentions` (`since_id`, `max_results`, `start_time`; user or app auth) is billed $0.005 per returned post for third-party users [V].
- Conversation retrieval: `GET /2/tweets/search/recent?query=conversation_id:<id>` covers the last 7 days on PPU, at $0.005 per post. Full-archive search is also on PPU (1 req/s) [V rate limits; search docs].
- Since 2026-05-04, search runs on a new index and retweets are no longer returned in keyword search [V changelog]. Count operators `min_likes:` and similar were deprecated on 2026-01-19 and re-added on 2026-05-04 [V].

### B8. Real-time options
- **X Activity API (XAA)** is GA on self-serve with **1,500 subscriptions** (Enterprise 75,000) [V XAA intro]. Delivery is by persistent HTTP stream (`GET /2/activity/stream`, 2 connections) or **webhook**. Relevant events:
  - `post.reply.create`: direct replies to the user's posts, not replies to replies
  - `post.mention.create`: explicit @mentions in the body, not the implicit mentions carried by replies
  - `post.quote.create`, `post.repost.create`, `post.create`, `post.delete`
  - `dm.received`/`dm.sent`, `chat.*` (encrypted XChat)
  - `oauth.revoke`
  - Reply, mention and quote are **private events**: they need the user's OAuth 2.0 authorization with `tweet.read`, and a subscription can only be created for users who authorized the app.
  - **Posts from protected accounts are never delivered.**
  - The payload is a full Post object (incl. `in_reply_to_tweet_id`, `conversation_id`, `entities.mentions`, `author_id`) wrapped in an envelope with `event_uuid` [V event payloads].
  - Optional `expires_at` per subscription. A subscription is removed automatically when the user revokes [V].
- **Webhooks (v2)** [V "V2 Webhooks API", "quickstart"]:
  - HTTPS only, public, **no port in the URL**, respond within **10 s** with 200.
  - **CRC:** a GET with `crc_token` must return `{"response_token":"sha256=" + base64(HMAC_SHA256(client_secret, crc_token))}`. It is checked on create, on PUT and every 30 min if not validated in 24 h. The webhook is marked invalid after about 28 h of failures.
  - **Signature:** `X-Twitter-Webhooks-Signature-OAuth2: sha256=…` over the raw body, signed with the **OAuth 2.0 client secret** (legacy header `X-Twitter-Webhooks-Signature` uses the consumer secret).
  - **Replay:** `POST /2/webhooks/replay` covers the last **24 h**.
  - Webhook management uses the app-only Bearer token.
- **Account Activity API (AAA)** is **being deprecated** in favour of XAA. PPU gets only 3 subscriptions and 1 webhook [V AAA intro]. Do not build on it.
- **Filtered stream:** PPU gets 1 connection and 1,000 rules, billed per delivered post [V]. Not needed for Motion.
- **Polling cost compared with webhooks:** both bill $0.005 per post delivered or returned, and empty polls are not billed [V]. Webhooks win on latency and rate-limit headroom; polling wins on dev simplicity (no public HTTPS, no port).

### B9. Direct messages
- v2 legacy DMs: `POST /2/dm_conversations/with/:participant_id/messages`, `/2/dm_conversations`, lookups `GET /2/dm_events…` (15 per 15 min per user). Scopes `dm.read dm.write` [V].
- Encrypted DMs (**XChat**) are a separate API that needs client-side key management through the Chat XDK [V xchat intro]. Messages sent this way can't be read server-side without keys. **Inbox parity for DMs is a large project.**
- **Policy:** automated DMs are allowed "only after user DMs you first", with an easy opt-out. Auto-DMs to new followers are prohibited, as are bulk DMs [V Developer Guidelines]. **Comment-to-DM (Motion's Instagram/Facebook flagship) is not allowed on X.**

### B10. Analytics [V docs "Metrics", get-post-analytics OpenAPI]
- `public_metrics` (impressions, likes, reposts, quotes, replies, bookmarks) work with any auth.
- `non_public_metrics` / `organic_metrics` (url_link_clicks, user_profile_clicks, engagements) need user context on owned posts and are **only available for posts created in the last 30 days**.
- Video playback quartiles come through the media expansion.
- **`GET /2/tweets/analytics`**: ≤100 ids, required `start_time`/`end_time`, `granularity=hourly|daily|weekly|total`, user context. It returns impressions, engagements, likes, replies, retweets, quote_tweets, bookmarks, shares, url_clicks, profile clicks, follows/unfollows, media_views, with time buckets. Pricing and look-back window are undocumented.
- **No account-level daily impressions endpoint** in v2 [V absence]. Account views must be derived from per-post buckets or deltas [I]. Followers come from `users/me?user.fields=public_metrics` ($0.01).

### B11. Developer account and app setup [V docs "Getting Access", "Developer Apps"]
1. Sign in at console.x.com, accept the Developer Agreement and Policy, and describe the use.
2. Create an app (name, description, use case).
3. Configure OAuth 2.0 as type **Web App (confidential)**, with permissions "Read and write" (add "Direct messages" only if needed), callback URLs (≤10, exact match), website, terms and privacy URLs [I for the last three, by analogy with the console form].
4. Save the Client ID/Secret and Bearer token. **They are shown once**, and regenerating invalidates the old ones.
5. Buy credits, set a **spend limit** and auto-recharge.
6. Register the webhook (`POST /2/webhooks`).

There is **no per-scope app review** like Meta's. AI-generated replies, however, need **prior written approval** (B12). Changing app permissions forces users to re-authorize [V]. At most 3 apps per use case (dev/staging/prod) [V Developer Policy].

### B12. Policies that shape an auto-posting, auto-replying product
From docs.x.com "Developer Guidelines" [V], "Developer Policy" [V], "Restricted Use Cases" [V], plus help.x.com Automation Rules [V-snippet]:
- **Allowed:** scheduled posting of your own content. Auto-reply to **users who reply to your post** ("user engaged first, limit 1 reply") or who @mention you asking for something. Automated DMs only after the user DMs first.
- **Not allowed:** "App auto-replies to anyone mentioning a keyword" (unsolicited); replies to random posts; bulk or uninvited @mentions; identical content across accounts; posting to trends for visibility; auto-likes or follows; scraping.
- **AI-generated replies need prior approval from X** (Policy Support form). "Deploying AI-generated replies without approval is a violation, even if the content itself is helpful" [V]. Forum staff reportedly said no extra approval is needed for rule-abiding mention bots, which conflicts with the page [R vorplabs summary]. Follow the page.
- **Automated accounts** must enable the "Automated" label, disclose the operator in the bio, link a human-managed account, and honour "stop" opt-outs immediately [V]. Whether a human creator's account that runs templated auto-replies counts as an "automated account" is not defined. **Owner and legal decision; ask X Policy Support.**
- Users must give explicit consent before automated replies or DMs, and opt-outs must be honoured [V Developer Policy].
- Explicit consent is needed before taking any action on a user's behalf [V], which Motion's OAuth connect provides.
- Violations can bring "app suspension, API access revocation, or permanent account bans" [V]. **Risk concentration:** one bad tenant can get Motion's single app suspended.

### B13. Compliance duties [V Developer Guidelines / Policy]
- Delete or modify stored X content **within 24 h** of a deletion request by X or the user, or when content is removed on X. Delete all X data **within 10 business days** of API termination.
- Keep offline copies in sync with X.
- Don't store DMs without consent. No off-X matching without consent. No sensitive-attribute inference. **No training of models on X content** (except Grok). Breaches must be reported. X may audit once per year.
- Tools: XAA `post.delete` for the user's own posts (free), and **batch compliance jobs** (`POST /2/compliance/jobs`, PPU, 150 per 15 min) for stored third-party replies and mentions. Compliance streams are Enterprise only [V].
- Motion-specific: the pre-flight and AI features send "your past post performance" text to OpenRouter models (`preflight.service.ts`). Inference isn't training, but **configure OpenRouter to exclude providers that train on prompts** before X content flows there [I].

### B14. Cost model at small scale (verified unit prices; usage assumptions are mine)
Per account per month: 5 posts/day = 150 posts.

| Line item | Lean | Typical | Heavy |
|---|---|---|---|
| Posts | 150 plain × $0.015 = **$2.25** | 120 plain + 30 with link = $1.80 + $6.00 = **$7.80** | 150 with link × $0.20 = **$30.00** |
| Alt text | 0 | 75 × $0.005 = $0.38 | 150 × $0.005 = $0.75 |
| Post metrics (decaying cadence) | 3 reads/post: $2.25 | 6 reads/post: $4.50 | 6 reads/post: $4.50 |
| Followers snapshot daily | $0.30 | $0.30 | $0.30 |
| Inbound replies/mentions (XAA) | 5/day: $0.75 | 20/day: $3.00 | 300/day: $45.00 |
| Replies sent (summoned $0.01) | 0 | 5/day: $1.50 | 20/day: $6.00 |
| **Per account** | **≈ $5.55** | **≈ $17.48** | **≈ $86.55** |
| 1 account | $5.55 | $17.48 | $86.55 |
| 10 accounts | $55.50 | $174.80 | $865.50 |
| 50 accounts | $277.50 | $874.00 | $4,327.50 |

One-time cost per connect: `users/me` $0.01 plus a 25-post import $0.125. Volumes stay far below the 3M-read cap. **Link posts and inbound events dominate**, so caps and plan limits are needed (D7, D15).

### B15. Gotchas (official unless marked)
- Authorization code valid for **30 s**: exchange immediately in the callback.
- `localhost` callbacks are rejected; use `127.0.0.1`.
- Webhook URLs **cannot include a port**, so ngrok or a reverse proxy on 443 is needed.
- Access token 2 h; refresh tokens single-use [R]. A lost refresh response forces a reconnect.
- Upload success ≠ post success (limits are checked twice). Wrong `media_category` makes post create fail.
- Media ids expire in 24 h, so upload at publish time, not at schedule time.
- Quote posts are Enterprise only. @mentions in scheduled posts may 403. Replies are gated by "summoned".
- XAA ignores protected accounts, and `post.reply.create` covers direct replies only.
- Non-public metrics are only available for 30 days.
- The deprecated count operators came back on 2026-05-04: X changes behaviour often, so watch the changelog RSS (`https://docs.x.com/changelog/rss.xml`).
- One X login per browser: connecting a second X account means switching accounts on x.com first [I].
- Official tooling worth using: **X API Playground** (local v2 emulator, 2025-12-23), the TypeScript XDK `@xdevplatform/xdk` (2025-11-03), and the OpenAPI spec at `https://docs.x.com/openapi.json` [V changelog].

---

## Part C. Fit and gaps (Motion feature → X)

| Motion feature | Verdict | Reason / what changes |
|---|---|---|
| Connect (OAuth) | **Needs adaptation** | PKCE plus a refresh token; a verifier store; 30-s code; `127.0.0.1` in dev; account health states; revoke on disconnect |
| Token refresh | **Needs adaptation** | 2-h access tokens, rotating refresh tokens, concurrency-safe single-flight refresh; Meta's nightly cron model doesn't fit |
| Schedule / publish text | **Works with adaptation** | Motion schedules itself. Publish goes through `POST /2/tweets`. Watch the duplicate-content 403 and the @mention restriction |
| Publish image/GIF/video | **Needs adaptation** | Byte upload (one-shot for images, chunked plus STATUS polling for GIF/video) instead of `PUBLIC_BASE_URL` pull. 4 images or 1 GIF or 1 video. Image ≤5 MB (Motion allows 100 MB). Transcode video |
| Carousel / Reels / Stories | **Not possible as such** | Map "4 images" to a multi-image post. Reels and Stories have no X equivalent; the composer hides them |
| Threads (multi-post) | **New capability** | Chain replies to your own posts; per-part state for resume. The AI `THREAD` idea format finally gets a native target |
| Polls, reply settings, alt text | **New, optional** | All on PPU. Alt text costs $0.005 per image |
| Quote posts | **Not possible** | Enterprise only |
| Planner / composer constraints | **Needs adaptation** | Weighted 280 counter (`twitter-text`): URL = 23, emoji/CJK = 2. Optional 25k for Premium (`subscription_type`). Warn on @mentions and on URL cost |
| Previews (`PhonePreview`) | **Needs adaptation** | X layout: text first, 1–4 media grid, 16:9 crops, "Show more" past 280 for long posts |
| Drafts | **Works as-is** | Lenient validation already; add `x` to allowed platforms and per-provider media caps |
| Inbox: replies and mentions | **Needs adaptation** | Use XAA `post.reply.create` + `post.mention.create` webhooks, or poll mentions. Each event costs $0.005. Show the username, not the raw id |
| Inbox: reply | **Works with constraints** | Replying to someone who replied to or mentioned you passes the "summoned" gate per policy [V], technically [I]. $0.01 per summoned reply |
| Inbox: private reply / DM | **Not advisable** | DMs only after the user DMs first. XChat encryption complexity. Hide the DM option for X |
| Hide reply | **Optional** | `PUT /2/tweets/:id/hidden`, needs `tweet.moderate.write` |
| Automations: keyword replies on own-post replies | **Needs guardrails** | Allowed: the user engaged first, 1 reply per interaction, opt-out, label question |
| Automations: keyword search across X | **Not allowed** | "Auto-replies to anyone mentioning a keyword" is prohibited |
| Automations: comment-to-DM | **Not allowed** | Unsolicited DM |
| Automations: AI-written auto-replies | **Not without X approval** | Prior written approval required. AI drafts with human approval are fine |
| Analytics: post | **Needs adaptation** | Batched lookup with public and non-public metrics (non-public only for 30 days), decaying cadence to control cost |
| Analytics: account daily | **Derived only** | No native endpoint. Derive from `tweets/analytics` daily buckets or impression deltas. Followers from `users/me` |
| Import history | **Works, metered** | 25 posts = $0.125 per connect. Don't run all-tenant syncs on connect |
| Pre-flight check | **Works with adaptation** | Add an X platform profile: 280-char hook, first line, media specs. No X data used for training (OpenRouter setting) |
| AI ideas / hooks | **Works with adaptation** | Add `x` to `ai.service.ts PLATFORMS`. Prompts should respect 280 weighted chars and thread format |
| Disconnect | **Needs fix (both)** | Revoke the X token, delete XAA subscriptions, soft-disconnect instead of cascade delete |

**Product decisions X forces:** link-post pricing (25–30× a plain post), DM-free automations, no keyword-search engagement, no quotes, the @mention caution in scheduled posts, the bot-label stance for auto-replies, Premium-dependent limits (text and video length), and per-tenant cost pass-through or caps.

---

## Part D. The plan

### D1. Order of work (earliest "connect and post" demo)
1. **Phase 0, decisions and setup** (owner, about 1 day): X app, credits, spend limit $25, test X account, decisions in D15.
2. **Phase 1a, fail-closed registry** (A4 steps 0–1, about 2–3 days). This removes the Facebook-fallback hazards.
3. **Phase 2, X vertical slice** behind `PROVIDERS_ENABLED`: OAuth PKCE connect, token service, text plus single-image publish through the existing scheduler. **Demo at about day 8.**
4. **Phase 1b, rest of the abstraction** (A4 steps 2–7), in parallel with or after the slice.
5. Phases 3 to 7: media/video/threads, retries and idempotency, frontend, inbox, automations, analytics, hardening, beta.

### D2. Refactor first, with proof of no Meta regression
- Golden-request snapshots of every Meta axios call (A4 step 0), recorded **before** the first refactor commit and asserted unchanged after each PR.
- Existing suites untouched in Phase 1a: `api.spec.ts` still overrides `PublishersService` with the same method names; `meta-graph.spec.ts` still reaches the same private methods.
- New hazard tests: unknown or `x` providers never reach Meta endpoints; `registry.get('nope')` throws.
- CI as today (`.github/workflows/ci.yml`: typecheck plus jest plus frontend lint/test/build). Add a manual smoke checklist in dev_mode with the Meta test users before merging steps 4 and 6 (they touch live redirect and webhook paths).

### D3. Data model and migrations (Prisma)
```prisma
model SocialAccount {
  // existing fields …
  refreshToken      String?   // enc:v2 ciphertext; X only for now
  scopes            String?   // space-separated granted scopes
  status            String    @default("ACTIVE") // ACTIVE | REAUTH_REQUIRED | REVOKED | DISABLED | BUDGET_PAUSED
  authError         String?
  tokenRefreshedAt  DateTime?
  tokenVersion      Int       @default(0)       // bumped on every successful refresh (CAS + 401-retry logic)
  limits            Json?     // e.g. { textMax: 280|25000, videoMaxSec: 1200|7500 } from subscription_type
  disconnectedAt    DateTime? // soft disconnect: keep history
  @@index([provider, status])
}
model ScheduledPost {
  // existing fields …
  errorCode         String?   // ProviderError code
  attempts          Int       @default(0)
  nextAttemptAt     DateTime?
  publishStartedAt  DateTime? // reaper + reconcile window
  options           Json?     // { replySettings, poll, altTexts[], paidPartnership, madeWithAi }
  parts             ScheduledPostPart[]
  @@index([status, nextAttemptAt])
}
model ScheduledPostPart {               // threads; single posts have exactly one part
  id String @id @default(cuid())
  postId String
  post   ScheduledPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  index Int
  text String?
  mediaUrls String @default("[]")
  externalId String?                   // set the moment X returns an id; resume skips parts that have one
  status String @default("PENDING")    // PENDING | SENDING | PUBLISHED | UNKNOWN | FAILED
  @@unique([postId, index])
}
model OAuthSession {                    // PKCE verifier + single-use state
  id String @id                         // 32 random bytes, b64url (goes into signed state as `sid`)
  userId String
  provider String
  codeVerifier String                   // encrypted
  redirectUri String
  expiresAt DateTime
  consumedAt DateTime?
  createdAt DateTime @default(now())
}
model InboundEvent {                    // durable webhook inbox (Meta and X)
  id String @id @default(cuid())
  provider String
  dedupeKey String @unique              // X event_uuid; Meta hash(entry.id, change)
  payload Json
  receivedAt DateTime @default(now())
  processedAt DateTime?
  attempts Int @default(0)
  error String?
  @@index([processedAt, receivedAt])
}
model ProviderUsage {                   // metered cost ledger + caps
  id String @id @default(cuid())
  day DateTime                          // UTC date
  provider String
  accountId String?
  op String                             // post.create, post.create.url, read.post, event.reply …
  units Int
  costMicros Int
  @@unique([day, provider, accountId, op])
}
model RateLimitState {
  key String @id                        // "x:user:<accountId>:POST /2/tweets" | "x:app:POST /2/tweets"
  remaining Int?
  resetAt DateTime?
  updatedAt DateTime @updatedAt
}
model AutomationOptOut { accountId String; externalUserId String; createdAt DateTime @default(now()); @@id([accountId, externalUserId]) }
// AutomationRule += scope ("OWN_POST_REPLIES"|"MENTIONS"), dailyCap Int?, perUserCooldownHours Int?, variants Json?, requireApproval Boolean
// CommentEvent  += kind ("COMMENT"|"REPLY"|"MENTION"|"QUOTE"), senderUsername, conversationId, parentExternalId, externalCreatedAt, deletedAt
```
- **Encryption:** extend `auth/crypto.ts` to `enc:v2:<kid>:iv.tag.ct`, with `TOKEN_ENCRYPTION_KEYS` (current plus previous) so the key can rotate, and **AAD = `${accountId}:${field}`** so ciphertexts can't be swapped between rows or between access and refresh. Keep decrypting `enc:v1`. Re-encrypt lazily on the next write.
- Change `ScheduledPost.account` and `CommentEvent.account` from `onDelete: Cascade` to soft disconnect. Keep the FK and set `disconnectedAt`; a background job purges later, honouring X's deletion rules.
- Migrations are additive with defaults, so they are safe for live data. Backfill `status='ACTIVE'`.

### D4. OAuth 2.0 PKCE connect flow
1. `GET /auth/x/start` (authenticated):
   - Create `OAuthSession{ id=rand32, userId, provider:'x', codeVerifier=rand(64 chars, 43–128 allowed), redirectUri, expiresAt=+10min }` with the verifier encrypted.
   - `state = signToken(userId,'oauth_state',600,{provider:'x', sid})`, about 260 chars, under X's 500 limit.
   - `code_challenge = b64url(sha256(verifier))`, `code_challenge_method=S256`.
   - `scope = 'tweet.read tweet.write users.read media.write offline.access'`.
   - Return `https://x.com/i/oauth2/authorize?...`.
   - Keep the verifier out of the URL: that is the point of PKCE.
2. `GET /auth/x/callback?code&state` (public):
   - On `error=access_denied`, show a friendly message.
   - Verify the JWT. Consume the session atomically: `updateMany({where:{id:sid,userId,consumedAt:null,expiresAt:{gt:now}}, data:{consumedAt:now}})`. If `count===0`, reject; this is the replay protection Meta's flow lacks.
   - Exchange **immediately** (30-s code) at `POST https://api.x.com/2/oauth2/token`: Basic auth, `grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`. Use a 10-s timeout.
   - Check the granted `scope` covers the required set; otherwise PERMISSION_MISSING.
   - `GET /2/users/me?user.fields=username,name,profile_image_url,public_metrics,subscription_type,verified_type,protected`.
   - Upsert `(userId,'x',id)` with encrypted access and refresh tokens, `tokenExpires = now + expires_in − 120s`, `status ACTIVE`, `limits` derived from `subscription_type`.
   - `afterConnect`: create XAA subscriptions `post.reply.create` and `post.mention.create` (user token, `webhook_id`); warn if `protected`. Import the last 25 original posts. Sync **this account only**.
   - Redirect to `/connect?connected=x`.
3. Option to harden login-CSRF further (decide in D15): make the redirect URI a **frontend** route (`/connect/x/callback`) that POSTs `{code,state}` to `POST /auth/x/complete` with the user's bearer token. The backend then checks `state.sub === currentUser`, binding the callback to the signed-in browser. The 30-s window easily allows this hop.
4. Disconnect: `POST /2/oauth2/revoke` for the refresh and access tokens, delete XAA subscriptions, soft-disconnect. If the same X account is connected in two Motion workspaces, warn: double automation means double risk.
5. Redirect URIs: `X_REDIRECT_URL` = `http://127.0.0.1:3001/auth/x/callback` in dev and `https://api.<domain>/auth/x/callback` in prod, registered exactly.

### D5. Token refresh under concurrency
`TokenService.accessToken(accountId)` is used through `CallContext.accessToken()`:
```
acc = read(accountId)
if acc.status != ACTIVE -> throw ProviderError(AUTH_*)
if acc.tokenExpires - now > 5 min -> return decrypt(acc.accessToken)
prisma.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'tok:' + accountId}, 0))`
  fresh = tx.socialAccount.findUnique(accountId)            // re-read inside the lock
  if fresh.tokenVersion != acc.tokenVersion || fresh.tokenExpires - now > 5 min -> return decrypt(fresh.accessToken)
  try   r = POST /2/oauth2/token (grant_type=refresh_token, Basic auth, timeout 10s)
        tx.update({ accessToken: enc(r.access_token), refreshToken: enc(r.refresh_token ?? old),
                    tokenExpires: now + r.expires_in - 120s, tokenVersion: +1, tokenRefreshedAt: now, status: ACTIVE, authError: null })
  catch 400 invalid_request|invalid_grant -> tx.update({ status: REAUTH_REQUIRED, authError }) ; throw AUTH_EXPIRED
        5xx|timeout -> throw TRANSIENT (keep old tokens)
}, { timeout: 15000 })
```
- The lock is Postgres-wide, so it works across several backend instances. Holding one pooled connection during the HTTP call is fine at this scale.
- **On 401 from any X call:** force-refresh once (compare `tokenVersion` so two callers don't refresh twice), then retry the call once.
- Residual risk: X rotates but the response is lost (timeout after success). The old refresh token is then dead and the next refresh puts the account into REAUTH_REQUIRED. Log it distinctly and surface the reconnect prompt. It cannot be fully prevented [I].
- **Keep-alive cron (daily):** refresh X accounts with `tokenRefreshedAt` older than 7 days, staggered, to stay well inside the reported ~6-month refresh-token lifetime [R]. Meta's nightly cron moves into the same service under `refreshPolicy:'extend-long-lived'`, with **no else-branch**.
- **UI:** `status` reaches `GET /accounts`.
  - The Connect page shows "Reconnect needed" with a button that restarts OAuth and keeps the same account row.
  - The composer greys out non-ACTIVE accounts.
  - The planner flags their posts.
  - The dashboard shows a banner.
  - Scheduler behaviour: the scheduler skips non-ACTIVE accounts. Posts stay `SCHEDULED` with `errorCode=AUTH_EXPIRED` for a grace period (e.g. 6 h past due), then become FAILED. Reconnecting resumes them automatically.

### D6. Publisher, scheduler, retries, idempotency, failure taxonomy
**X publish algorithm** (`XPublisher.publish`):
1. `validate()`, the same code the composer calls:
   - Weighted length via `twitter-text` (`parseTweet().weightedLength` ≤ `limits.textMax`).
   - Media: ≤4 images, or 1 GIF, or 1 video, no mixing; images ≤5 MB; GIF ≤15 MB; supported MIME types.
   - Video probe through the existing `preflight/media-probe.ts` (ffprobe): H.264/AAC, duration within the account limit.
   - Poll shape.
   - **Warn** (don't block) on @mentions and URLs (cost and policy).
2. Media resolution:
   - **Only Motion uploads** (`/media/<UPLOAD_NAME>` resolved to `UPLOAD_DIR`, with path-traversal-safe resolution).
   - Pasted external URLs for X are rejected with "upload the file", or fetched with an SSRF-safe fetcher: https only, DNS check rejecting private and loopback ranges, size cap, content-type check, 30-s timeout.
   - Transcode non-conforming video with ffmpeg to H.264 High / AAC-LC / ≤1280×720 or 720×1280 / yuv420p / closed GOP.
3. Upload at publish time:
   - Images: one-shot `POST /2/media/upload`.
   - GIF/video: initialize (`tweet_gif`/`tweet_video`), then append in ≤5 MB chunks, then finalize, then STATUS polling with `check_after_secs` (cap about 10 min, reuse `waitForContainer`-style backoff and the `sleep()` seam).
   - Alt text: `POST /2/media/metadata`.
4. For each `ScheduledPostPart` without `externalId`, in order:
   - Set `status=SENDING` and `publishStartedAt`.
   - `POST /2/tweets {text, media, reply_settings?, poll?, reply:{in_reply_to_tweet_id: prevId}?}`.
   - On 201, **immediately** persist `externalId` and `PUBLISHED`.
   - Post `externalId` = first part id. Permalink = `https://x.com/<username>/status/<id>`.
5. Idempotency (no API key exists):
   - The scheduler claim guarantees a single worker.
   - Per-part `externalId` guarantees parts are never re-sent after success.
   - For an **ambiguous failure** (timeout, connection reset, 5xx after the request was sent, or a `DUPLICATE` 403): set the part to `UNKNOWN`. Run `reconcile()`: `GET /2/users/:id/tweets?start_time=publishStartedAt−2min&max_results=10&tweet.fields=created_at,text` (≤$0.05) and match the normalized text, plus `in_reply_to` for thread parts. If found, adopt the id. If not found and the error was transient, retry. If still unresolved, set **NEEDS_ATTENTION** ("We couldn't confirm whether this was posted, check your profile"). **Never blind-repost.**

**Scheduler changes** (`scheduler.service.ts`):
- Select `status='SCHEDULED' AND scheduledAt<=now` **plus** `status='RETRY_WAIT' AND nextAttemptAt<=now`, joined to ACTIVE accounts.
- Raise `take` and add per-provider concurrency (X: per-account serialization, because threads must be sequential).
- **Reaper:** `PUBLISHING` with `publishStartedAt < now−15min`. For X, run reconcile. For Meta, mark FAILED/UNKNOWN_OUTCOME (Meta container ids can be reconciled later).
- For multiple instances, keep the conditional-update claim (already safe) and move crons behind a Postgres advisory "leader" lock so insights and refresh don't run twice.

**Retry policy:**
- TRANSIENT and RATE_LIMITED retry with exponential backoff and jitter (1, 5, 15, 60 min). RATE_LIMITED is scheduled at `x-rate-limit-reset` (or `max(reset, 60s)`). ACCOUNT_LIMIT waits for the next half-hour window or 24 h.
- At most 5 attempts **and** at most `MAX_LATE` (default 6 h) after `scheduledAt`. After that, FAILED "too late to post", because stale content is worse than none.
- No auto-retry for VALIDATION, MEDIA_REJECTED, DUPLICATE (after reconcile), POLICY_BLOCKED or PERMISSION_MISSING.
- **BILLING_EXHAUSTED** (credits at zero or spend cap reached: requests "blocked until you add credits" [V]) acts as a **global X circuit breaker**: pause all X jobs (`RETRY_WAIT`), alert the admin, and resume when `GET /2/usage/credits` > 0.
- Per-tenant budget exceeded sets account `BUDGET_PAUSED`.

**Failure taxonomy shown to users** (stored as `errorCode` plus a friendly `error`; raw JSON goes to logs only):

| Code | User sees | Action button |
|---|---|---|
| AUTH_EXPIRED / AUTH_REVOKED | "Reconnect your X account to publish." | Reconnect |
| PERMISSION_MISSING | "Motion needs permission to post and upload media." | Reconnect |
| RATE_LIMITED | "X asked us to slow down. Retrying at 10:15." | (auto) |
| ACCOUNT_LIMIT | "This X account hit X's daily posting limit. Retrying later." | Reschedule |
| BILLING_EXHAUSTED | "X publishing is paused on Motion's side. We'll retry automatically." | (auto) |
| VALIDATION | "Too long for X (312/280)." / "X allows 4 images or 1 video." | Edit |
| MEDIA_REJECTED | "X couldn't process this video (longer than 20 min for this account)." | Replace media |
| DUPLICATE | "X rejected this as a duplicate of a recent post. Change the text." | Edit |
| POLICY_BLOCKED | "X blocked this because it mentions or replies to accounts not in the conversation." | Edit |
| TRANSIENT (exhausted) | "X was unavailable. We tried 5 times." | Retry |
| UNKNOWN_OUTCOME | "We couldn't confirm whether this was posted. Check your profile." | Mark posted / Retry |

Add `POST /posts/:id/retry` (FAILED/NEEDS_ATTENTION back to SCHEDULED, resuming at the first unpublished part) for **all providers**.

### D7. Ingestion: mentions and replies (webhook vs polling)
- **Decision: XAA webhooks in staging and prod; mentions polling as the dev and outage fallback.**
- Cost is equal per item ($0.005 per post delivered or returned; empty polls are free [V]). Webhooks give seconds of latency and no rate-limit pressure (mentions polling is 300 per 15 min per user). XAA allows 1,500 subscriptions, which at 2–3 per account is about 500–750 accounts before Enterprise [I].
- Setup (an ops script, `npm run x:webhook:setup`):
  - Create one webhook at `X_WEBHOOK_URL` (`https://<domain>/webhooks/x`, no port) with the app Bearer token.
  - Create one app-level `oauth.revoke` subscription.
  - At connect, create per-account `post.reply.create` and `post.mention.create` subscriptions with the user token. `post.quote.create` is optional, read-only (quotes can't be answered programmatically unless summoned).
- `GET /webhooks/x?crc_token=` returns `{response_token: 'sha256=' + base64(hmac(X_CLIENT_SECRET, crc_token))}`.
- `POST /webhooks/x` (`@Public()`, `@SkipThrottle()`, raw body):
  - Verify `X-Twitter-Webhooks-Signature-OAuth2` (timing-safe; reuse the `verifyMetaSignature` pattern with base64 instead of hex).
  - Insert `InboundEvent(dedupeKey=event_uuid)` and return 200 in under 1 s.
  - A worker drains events into `CommentEvent(kind REPLY|MENTION, senderUsername from includes, conversationId, parentExternalId=in_reply_to_tweet_id)`, then automations.
  - `oauth.revoke` sets the account to `REVOKED`.
- **Recovery:** on boot and every 30 min, if the newest X event is older than expected and the webhook shows invalid (`GET /2/webhooks`), call `POST /2/webhooks/replay` (24-h window). For gaps over 24 h, use a one-off mentions poll with `since_id`.
- **Spend guard:** each account has an inbound budget (e.g. 3,000 events per month on the base plan). At 80%, warn the user. At 100%, `DELETE` that account's XAA subscriptions, switch to a 1-hour digest poll capped at N items, and show "Inbox paused for X: volume limit". X bills every delivered event, and a viral post could otherwise cost hundreds of dollars a day.
- Store usernames for display (`includes.users`). The current inbox shows `senderId` (`app/comments/page.tsx` l.121), which is useless for X numeric ids.

### D8. Automation guardrails (so the product can't get users suspended)
Enforced **server-side** from `capabilities.automation` in `AutomationsController.create` and in `AutomationsService.handleComment`:
1. Triggers on X are only `OWN_POST_REPLIES` (from `post.reply.create`) and `MENTIONS` (from `post.mention.create`). Keywords filter *within* these. **No search-based triggers** [V: keyword auto-replies prohibited].
2. `replyMode` on X is PUBLIC only. Reject `DM` and `PUBLIC_AND_DM` with a clear message.
3. **Exactly 1 automated reply per interaction**, which the existing `CommentEvent` claim provides. Add a per-user cooldown (default 24 h per account per user), a per-account daily cap (default 50, well below the 200 replies/day unverified-account limit [V-snippet]), and global per-app throttling.
4. **Opt-out:** replies containing `stop|unsubscribe|opt out` add to `AutomationOptOut` and are never auto-replied again [V].
5. **Templated text only.** Require at least 3 variants per rule and rotate, to avoid identical-content flags and duplicate 403s. No links by default (cost and spam). No @mentions of third parties. **AI-generated auto-replies are disabled for X** unless X's written approval is on file (an admin feature flag). AI *suggestions* in the inbox with human send are fine.
6. Never reply to protected, own, or Motion-generated posts (reuse `isOwnComment`, plus X `author_id === account.externalId`). Only reply to **direct** replies (nested threads skipped), which is consistent with XAA semantics and the "summoned" gate.
7. **Kill switches:**
   - Auto-pause a rule after 3 POLICY_BLOCKED (403) responses in an hour.
   - Global `X_AUTOMATIONS_ENABLED`.
   - Rules start in "suggest" mode (human approve) for the first N replies [I recommendation].
8. **Disclosure:** when enabling the first X rule, show an acknowledgement covering X's Automation Rules (label, bio disclosure, opt-out) and link to the X setting. Record consent (`AutomationRule.createdAt` plus acknowledgement timestamp).

### D9. Analytics sync within X's limits
- **Post metrics:** collect due posts and call `GET /2/tweets?ids=<≤100>&tweet.fields=public_metrics,non_public_metrics,organic_metrics,created_at` with the user token. Request non-public fields only if `created_at` is within the last 30 days; otherwise public only.
- **Cadence** per post age: 1 h, 6 h, 24 h, 72 h, 7 d, 30 d, then stop. That is ≤6 billed reads per post, and per-UTC-day dedup makes extra same-day reads free [V].
- Mapping to `PostInsight`: views = `impression_count`, likes = `like_count`, comments = `reply_count`, shares = `retweet_count + quote_count`, saves = `bookmark_count`, engagements = `non_public_metrics.engagements ?? sum`.
- **Account daily:** followers via `users/me` once a day ($0.01). Daily "views" come from `GET /2/tweets/analytics?granularity=daily` for posts under 30 days old, if its price is acceptable (verify in the console first). Otherwise derive them from day-over-day impression deltas of tracked posts. Label it in the UI as "views on posts Motion knows about".
- Remove `insights.syncAll()` from OAuth `done()`; sync only the new account. Give `InsightsService` per-provider cadence instead of a fixed 6-h all-account loop.
- Log every billed call in `ProviderUsage` (op, units, cost) for per-tenant cost visibility.

### D10. Frontend work
- `GET /providers` drives everything. `lib/format.ts` keeps typed fallbacks, removes the "default to Instagram" branches and adds `x`. Add an X icon to `components/Icons.tsx` following X brand guidelines, and `.platform-avatar.x` in `globals.css`.
- **Connect page** (`app/connect/page.tsx`):
  - X card ("Opening X…").
  - Provider-neutral steps (currently "Approve on Meta").
  - Account status pills: Connected / Reconnect needed / Revoked / Paused (budget), with a **Reconnect** action.
  - Hint: "To connect another X account, switch accounts on x.com first."
  - Fix the disconnect copy to match the new soft-disconnect semantics.
- **Composer** (`components/Composer.tsx`):
  - Weighted counter via `twitter-text` for X ("URLs count as 23"; 280 or the Premium limit).
  - Format list from capabilities (no Reels/Stories for X).
  - Media rules (4 images or 1 GIF or 1 video, ≤5 MB images) with errors **before** upload.
  - Alt-text field per image.
  - Reply-settings select.
  - **Thread builder** (split long text at sentence boundaries into numbered parts, each with its own counter and media).
  - Optional poll builder.
  - Warnings: "@mentions may be blocked by X unless those accounts are already in the conversation" and "Links on X count as 23 characters" (plus a plan-quota hint if links are metered, D15).
- **PhonePreview:** X variant (avatar, name, @handle, text with "Show more" past 280 for Premium long posts, 1–4 image grid, 16:9 video). Add preview tabs from capabilities.
- **Planner:** X in the filter (`app/planner/page.tsx` l.179). Thread posts show "1/5". Failed posts show the friendly reason plus the action button from the taxonomy.
- **Inbox** (`app/comments/page.tsx`):
  - X replies and mentions with @username.
  - Reply box with the X counter (replace `REPLY_LIMIT=500` with a per-provider limit).
  - Hide the DM checkbox for X. Optional "Hide reply".
  - "Open on X" link.
- **Automations:** per-provider form (X: PUBLIC only, scope selector, variants, caps, cooldown, opt-out note, policy acknowledgement).
- **Analytics:** X channel row; "Impressions" label; note that private metrics stop after 30 days.
- **Lab / Brand / Hooks / Pre-flight:** add X to `PLATFORMS` arrays (`app/lab/page.tsx`, `BrandSheet.tsx`, `HooksView.tsx`, `preflight/shared.tsx`, backend `ai.service.ts`). X prompts respect 280 weighted characters and the thread format.

### D11. Testing
- **Unit and contract** (existing style, `jest.mock('axios')`): `test/x-api.spec.ts` pins hosts, paths, headers (`Authorization: Bearer`, Basic for token), and bodies for token exchange and refresh, `users/me`, media init/append/finalize/status, metadata, tweet create (single, reply chain, poll, reply_settings), delete, lookup with metrics, XAA subscription create/delete, revoke.
- Validate request bodies against the official OpenAPI (`docs.x.com/openapi.json`, vendored and pinned by version) with an OpenAPI validator in tests. Fail CI when X changes the spec and we haven't reviewed it.
- **Fixtures:** XAA payload samples copied from docs (`post.reply.create`, `post.mention.create`, `oauth.revoke`).
- **Webhook tests** (mirroring the Meta ones in `api.spec.ts`): CRC response, unsigned and badly signed rejected (401), signed accepted, duplicate `event_uuid` processed once, durable processing after a simulated crash.
- **Concurrency tests:**
  - 5 parallel `accessToken()` calls produce 1 refresh HTTP call and persist the rotated token.
  - `invalid_grant` sets REAUTH_REQUIRED, and the scheduler skips the account.
  - 401 mid-call refreshes once and retries once.
- **Idempotency tests:**
  - Timeout after send, then reconcile finds the post, so there is no second POST.
  - A thread where part 2 fails resumes at part 2.
  - A DUPLICATE 403 leads to reconcile and then NEEDS_ATTENTION.
  - Reaper recovers a stuck PUBLISHING post.
- **Policy tests:**
  - An X rule with DM is rejected.
  - Keyword rules fire only for reply or mention events.
  - Cooldown, daily cap and opt-out are honoured.
  - No reply to own or nested posts.
- **Integration:** run the official **X API Playground** (`go install github.com/xdevplatform/playground/cmd/playground@latest`) in CI as a service container with `X_API_BASE` pointing at it, for end-to-end publish and media flows [V that the tool exists; its coverage of media and XAA is unverified].
- **Live smoke** (manual, staging): a dedicated X test account and a $10 spend cap. Connect, post text, image, video and thread, reply to a reply from a second account, receive the webhook, disconnect and revoke.
- Keep the golden Meta snapshots plus the existing suites green throughout. Add `/auth/x/start` to the protected-routes list. Add `X_*` test env vars to `test/env.ts`.

### D12. Observability, secrets, feature flags, rollout, docs
- **Logs** (structured): `provider, accountId, op, status, errorCode, x-rate-limit-*`, cost. Never log tokens; redact `Authorization`.
- **Metrics:** publish success rate per provider, retries, NEEDS_ATTENTION count, refresh failures, REAUTH accounts, 429s, inbound event lag, webhook validity, per-tenant spend.
- **Alerts:** credits below threshold (poll `GET /2/usage/credits` hourly [V]); spend above 80% of cap; webhook invalid; refresh failure spike; POLICY_BLOCKED spike; any NEEDS_ATTENTION.
- **Secrets** (`backend/.env.example` additions): `X_CLIENT_ID`, `X_CLIENT_SECRET` (also signs webhooks and CRC), `X_BEARER_TOKEN` (app-only, webhook and XAA admin), `X_REDIRECT_URL`, `X_WEBHOOK_URL`, `X_API_BASE` (tests), `X_SCOPES`, `X_MONTHLY_BUDGET_USD`, `TOKEN_ENCRYPTION_KEYS`.
  - Rotating the client secret also changes webhook signatures, so the runbook is: rotate, then `PUT /2/webhooks/:id` to re-CRC, with dual-verify during the switch.
- **Feature flags:** `PROVIDERS_ENABLED=instagram,facebook_page,threads,x` (server-enforced: `/auth/x/start` returns 404 when off, and `GET /providers` hides it), `X_BETA_USER_IDS`, `X_AUTOMATIONS_ENABLED`, `X_AI_REPLIES_APPROVED`.
- **Rollout:**
  1. Internal account.
  2. 5 beta users with per-tenant caps and daily cost review.
  3. 25 users.
  4. GA.
  - Hold automations until 2 weeks of clean publish metrics.
- **Docs:** `X_SETUP.md` (console steps, scopes, callbacks, `127.0.0.1` dev note, webhook setup script, spend limits, policy checklist). Update `README.md` (Security, Operations: credits, webhook), `META_SETUP.md` (shared provider notes), and the privacy policy (X data handling, 24-h deletion).

### D13. Milestones (engineer-days; one experienced full-stack engineer)
| # | Milestone | Effort | Depends on | Output |
|---|---|---|---|---|
| M0 | Owner decisions, X app, credits, test accounts | 1 (owner) | — | Credentials, budget |
| M1a | Golden tests plus fail-closed registry (A4 steps 0–1) | 2–3 | — | Meta hazards removed |
| M2 | Migrations (D3), crypto v2 with AAD, TokenService (D5) | 3 | M1a | Health states, safe refresh |
| M3 | X OAuth PKCE connect, Connect page states, revoke | 3 | M2 | **Demo: connect X** |
| M4 | X publisher text plus single image, scheduler integration, taxonomy v1 | 3 | M3 | **Demo: connect and post (≈ day 8–10)** |
| M1b | Rest of the abstraction (A4 steps 2–7) incl. durable InboundEvent | 5–6 | M1a | Cheap platform #5 |
| M5 | Media: multi-image, GIF, chunked video, transcode, alt text, threads | 4–5 | M4 | Full publishing |
| M6 | Retries, reconcile, reaper, retry endpoint, budget circuit breaker | 3 | M4 | "Never twice" guarantees |
| M7 | Frontend: capabilities, composer counter, thread builder, preview, icons, planner | 5–6 | M3, M5 | UX parity |
| M8 | XAA webhooks, CRC/signature, inbox for X, reply, spend guard | 4 | M1b, M2 | Inbox |
| M9 | Automations guardrails for X (+ opt-out, caps, variants) | 3 | M8 | Safe automations |
| M10 | Analytics sync for X (cadence, ledger) | 3 | M4 | Analytics |
| M11 | Playground CI, OpenAPI contract tests, observability, alerts, docs | 4–5 | M5–M10 | Production readiness |
| M12 | Beta rollout, fixes, cost review | 3–5 | all | GA |
| | **Total** | **≈ 46–56** | | |

Critical path to the first demo: M0 → M1a → M2 → M3 → M4. M1b can run in parallel after M1a.

### D14. Risks
1. **Policy volatility:** reply, mention and quote restrictions (Feb 2026) and the price change (Apr 2026) came with little notice. Mitigations: capabilities as data, a kill switch per feature, and a weekly watch of the changelog RSS.
2. **Cost blow-ups:** link posts at $0.20, uncapped inbound events billed per event, viral accounts. Mitigations: ledger, per-tenant caps, budget pause, spend limit in the console.
3. **App-level suspension:** a single Motion app means one abusive tenant can take X away from everyone. Mitigations: guardrails, rate caps, abuse monitoring, and terms that prohibit spam.
4. **Undocumented gates:** whether replies to commenters on your own posts always pass the "summoned" check; @mention blocking in standalone posts. Mitigation: staging tests before promising the feature.
5. **Token rotation edge cases** forcing reconnects. Mitigations: single-flight lock, keep-alive, clear reconnect UX.
6. **Webhook reliability:** retry semantics undocumented, replay limited to 24 h. Mitigations: durable inbox, replay job, polling backfill.
7. **Premium-dependent behaviour** (text length, video duration) varies per user. Mitigation: read `subscription_type` at connect and daily.
8. **Scale ceilings:** 10,000 posts per 24 h per app; 1,500 XAA subscriptions; 3M reads. Enterprise becomes necessary around 500–2,000 accounts.
9. **Compliance:** 24-h deletion duty for stored third-party replies. Mitigations: weekly batch-compliance job and purge on `post.delete`.
10. **Meta regressions during the refactor.** Mitigations: golden snapshots, unchanged suites, staged PRs.

### D15. Decisions the product owner must make
1. **Budget and billing:** monthly X spend limit, auto-recharge amount, and whether X costs are bundled, metered or plan-limited (posts per month, link posts per month, inbound events per month).
2. **Link posts** ($0.20): allow freely, warn, plan-gate, or suggest "link in first reply" (a reply with a link is also $0.20, so it doesn't save money).
3. **X automations:** off at launch, templated-only with caps (recommended), or never. Stance on the "Automated" label for customer accounts. Whether to request X approval for AI replies.
4. **DMs on X:** defer (recommended) vs build legacy DMs plus XChat.
5. **Real-time ingestion:** XAA webhooks (needs a public HTTPS host without a port) vs polling only. The per-account inbound cap.
6. **Premium features:** support 25k long posts and 125-min video when `subscription_type` allows?
7. **v1 scope:** threads and polls at launch, or text, images and video first?
8. **Callback hardening:** backend callback (simpler) vs a frontend callback with a bearer-bound completion (stronger).
9. **Disconnect semantics for all providers:** soft disconnect with retention (recommended) vs today's cascade delete.
10. **Data retention:** how long to keep X replies and mentions, and the compliance-sweep frequency.

### D16. Add to the Meta side while refactoring (gaps noticed)
- Fix **disconnect**: soft disconnect, revoke or unsubscribe, correct the copy (`connect/page.tsx` l.61 vs the cascade in `schema.prisma`).
- Remove **`POST /auth/exchange`** (raw tokens to the browser; unused).
- Add **account health** (`status`, `authError`) driven by refresh failures and OAuth 190 errors. Validate Page tokens daily (they never expire but can be revoked).
- Single-use OAuth state (the `OAuthSession` table) for Meta too.
- **Error taxonomy and friendly messages** instead of raw Graph JSON in `ScheduledPost.error`. Add a **Retry** action. Add a **reaper** for stuck `PUBLISHING` posts. Add retry with backoff for transient Graph errors (codes 1, 2, 4, 17, 32, 613).
- **Durable webhook inbox** (`InboundEvent`) instead of in-memory `enqueue`. Constant-time compare for `hub.verify_token`.
- Stop `syncAll()` on every connect; sync only the new account. Add a leader lock for crons before running more than one replica.
- Send Meta tokens in the `Authorization: Bearer` header instead of `access_token` query params where Graph allows, so tokens stay out of URLs and logs. Consider `appsecret_proof` with "Require App Secret" enabled.
- Ingest Threads replies (the webhook secret is already configured; the parser ignores them) and show them in the inbox.
- Paginate history imports (25 posts today) and carousel publishing (`CAROUSEL` throws today).
- Move uploads to object storage (S3-compatible) before scaling beyond one instance.
- Key versioning and AAD for token encryption (benefits Meta tokens too).

---

## Sources

Official (X):
- https://docs.x.com/x-api/getting-started/pricing (fetched as `.md`; no date on page): PPU model, all unit prices, Owned Reads conditions, 24-h UTC dedup, 3M cap, XAA event prices, auto-recharge and spend limits, xAI rebates.
- https://docs.x.com/changelog (`.md`), entries dated:
  - 2025-01-16 / 2025-04-30: v2 media upload launch.
  - 2025-10-03: post edit, Premium, 1 h.
  - 2025-10-18: XAA beta.
  - 2025-10-20: PPU pilot.
  - 2025-11-03: XDKs.
  - 2025-12-23: Playground.
  - 2026-01-15: AAA OAuth2.
  - 2026-01-19: count-operator deprecation.
  - 2026-02-06: PPU launch.
  - 2026-02-23: summoned-reply, mention and quote restriction.
  - 2026-03-11 / 03-13 / 03-18: XAA DMs, event names, direction filter.
  - 2026-03-20: replay deprecation.
  - 2026-04-16: Owned Reads, $0.015/$0.20/$0.01, Likes/Follows/Quotes removed (effective 2026-04-20).
  - 2026-05-04: new search index.
  - 2026-06-03: `paid_partnership`.
  - 2026-06-04: post create/delete XAA events.
  - 2026-09-01: media limits and v2 chunk paths.
  - 2026-09-21: OAuth 1.0a token exchange.
  - 2026-10-01: Grok reply moderation guide.
  - 2026-10-02: free credits.
- https://docs.x.com/x-api/posts/create-post: request fields, quote = Enterprise only, scopes, media count, poll limits, edit, video errors.
- https://docs.x.com/fundamentals/counting-characters: 280 weighted chars, emoji/CJK = 2, URL = 23, NFC, twitter-text.
- https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code and https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token: authorize, token and revoke URLs, S256/plain, 30-s code, 2-h tokens, offline.access, scopes list, Basic auth for confidential clients.
- https://docs.x.com/resources/fundamentals/developer-apps: app types, ≤10 callbacks, exact match, `127.0.0.1` not `localhost`, permissions changes force re-auth.
- https://docs.x.com/x-api/getting-started/getting-access: console signup, credentials shown once.
- https://docs.x.com/x-api/media/quickstart/media-upload-chunked, https://docs.x.com/x-api/media/quickstart/best-practices, media OpenAPI pages (initialize, metadata, status): v2 media flow, categories, limits, alt text ≤1000, `media.write`.
- https://docs.x.com/x-api/fundamentals/rate-limits: per-endpoint limits, headers, 429 handling.
- https://docs.x.com/x-api/fundamentals/metrics and https://docs.x.com/x-api/posts/get-post-analytics: metric types, 30-day non-public window, analytics endpoint params.
- https://docs.x.com/x-api/fundamentals/post-cap: billing FAQ ("only successful responses that return data are billed"), tracked endpoints.
- https://docs.x.com/x-api/usage/introduction: `/2/usage/tweets`, `/2/usage/credits`.
- https://docs.x.com/x-api/activity/introduction, /quickstart, /event-payloads, /create-x-activity-subscription: XAA events, privacy, scopes, 1,500 subscriptions, billing per post event, payload shape.
- https://docs.x.com/x-api/webhooks/introduction, /quickstart, /create-replay-job-for-webhook: HTTPS without port, 10-s response, CRC algorithm, OAuth2 signature header, 24-h replay.
- https://docs.x.com/x-api/account-activity/introduction: AAA deprecated; PPU 3 subscriptions / 1 webhook.
- https://docs.x.com/x-api/posts/filtered-stream/introduction: PPU 1 connection / 1,000 rules.
- https://docs.x.com/x-api/direct-messages/manage/introduction and https://docs.x.com/xchat/introduction: DM endpoints; XChat encryption model.
- https://docs.x.com/x-api/compliance/batch-compliance/introduction, https://docs.x.com/x-api/compliance/streams/introduction: batch compliance on self-serve; streams Enterprise.
- https://docs.x.com/developer-guidelines: allowed and forbidden automation scenarios, AI-reply prior approval, Automated label, opt-out, 24-h deletion, redistribution limits, no AI training.
- https://docs.x.com/developer-terms/policy and https://docs.x.com/developer-terms/restricted-use-cases: consent, deletion within 24 h, max 3 apps, no identical cross-account content, no aggregate X metrics, no model training.
- https://docs.x.com/x-api/users/get-my-user (OpenAPI): `subscription_type`, `verified_type`.
- https://docs.x.com/x-api/fundamentals/response-codes-and-errors: problem types, 429, partial errors.

Official, seen via search snippet only (page blocks fetching):
- https://devcommunity.x.com/t/x-api-v2-update-addressing-llm-generated-spam/257909: mention and quote restrictions ("already involved in any ongoing context").
- https://x.com/XDevelopers/status/2026084506822730185: reply restriction tiers (Free/Basic/Pro/PPU; Enterprise and Public Utility exempt).
- https://devcommunity.x.com/t/important-update-legacy-x-api-basic-plans-are-moving-to-pay-per-use-ppu/266305 and …/273255 (Pro): migration dates 2026-06-01 and 2026-09-01.
- https://devcommunity.x.com/t/x-api-pricing-update-owned-reads-now-0-001-other-changes-effective-april-20-2026/263025: URL pricing announcement.
- https://devcommunity.x.com/t/media-upload-endpoints-update-and-extended-migration-deadline/241818: v1.1 media sunset 2025-06-09.
- https://help.x.com/en/rules-and-policies/x-limits: 2,400 posts/day; unverified 50 posts / 200 replies per day; 500 DMs/day.
- https://help.x.com/en/rules-and-policies/x-automation: keyword auto-replies not permitted, opt-in and opt-out, Automated label, AI reply bots need approval.
- https://devcommunity.x.com/t/restricting-programmatic-replies-does-this-affect-replying-to-itself/257955: self-replies allowed.
- https://devcommunity.x.com/t/refresh-token-expiring-with-offline-access-scope/168899 and related threads: single-use refresh tokens, ~6-month lifetime.

Third-party (used only where marked [R]):
- https://www.ayrshare.com/docs/apis/post/social-networks/x-twitter: Premium long posts via API.
- https://www.ayrshare.com/solutions/x-twitter-api-error-403-duplicate-post-how-to-fix-it/: duplicate-content 403.
- https://opentweet.io/blog/x-api-link-post-fee and https://gigazine.net/gsc_news/en/20260422-x-api-link-price-up/: own-domain links count; replies with links billed at $0.20.
- https://vorplabs.com/agent-tools/x-api: forum staff comments on approval.
- https://fireply.ai/blog/x-api-reply-restriction-2026: which tools survived; self-reply plugs work.
- Pricing summaries (blotato, outstand, postproxy): Enterprise "~$42k/month".

Repo files read: `backend/src/{meta.service,meta-config,auth.controller,accounts.controller,publishers.service,scheduler.service,webhooks.controller,automations.service,automations.controller,comments.controller,insights.service,analytics.controller,dashboard.controller,posts.controller,drafts.controller,media.controller,media-rules,rate-limit,app.module,main,configure-app,uploads-cleanup.service}.ts`, `backend/src/auth/{crypto,auth.guard,users.controller}.ts`, `backend/src/ai/ai.service.ts`, `backend/prisma/schema.prisma`, `backend/.env.example`, `backend/test/{api,meta-graph,crypto}.spec.ts`, `backend/test/env.ts`, `backend/package.json`, `META_SETUP.md`, `README.md`, `docker-compose.yml`, `.github/workflows/ci.yml`, `frontend/app/{connect,comments,automations}/page.tsx`, `frontend/lib/{format,posts,media,text}.ts`, `frontend/components/{Composer.tsx,studio/PhonePreview.tsx}`, plus targeted greps of the planner, analytics, lab, Icons, globals.css and PostDrawer.

## Unverified / needs owner confirmation
1. Whether **replying to a user who replied to your post** always passes the 2026-02-23 "summoned" gate technically. Policy says allowed [V]; the API behaviour is inferred. **Test in staging before selling inbox replies or automations on X.**
2. Whether such replies bill as "summoned" ($0.010) or as a normal post ($0.015).
3. Exact scope of the **@mention restriction for standalone scheduled posts** (snippet plus a forum report). Test with a post mentioning a non-participant.
4. **Refresh-token rotation and ~6-month lifetime** (developer reports; not on docs.x.com).
5. **Premium long posts (25,000 chars) via `POST /2/tweets`** (third-party docs only).
6. Price of **media upload** calls and of **`GET /2/tweets/analytics`**, plus that endpoint's look-back window. Check the Developer Console price list.
7. Whether OAuth token or refresh calls and `users/me` at connect are billed (`users/me` presumably User read, $0.01).
8. Duplicate-content window length, and the error code when **credits are exhausted** (likely 402/429 with `usage-capped`; handle both).
9. XAA webhook **delivery retry semantics** (only the 24-h replay is documented).
10. Whether a creator account using Motion's templated auto-replies must enable the **"Automated" label**. Ask X Policy Support.
11. Whether **AI-assisted but human-approved** replies need X approval (guidelines suggest no; confirm).
12. X API Playground's coverage of media upload and XAA (for CI use).
13. Enterprise pricing and the thresholds at which Motion would need it (10k posts/day/app, 1,500 XAA subscriptions).
14. Video dimension limits (page lists 1280×1024 max yet allows 1080p for subscribers). Confirm with a real 1080×1920 upload.
15. The backend test count: owner says 127; my static count of `it()` plus expanded `it.each` is higher. Run `npm test` to set the baseline.
