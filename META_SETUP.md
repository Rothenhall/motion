# Meta App Setup — Motion (1671903081190592)

Checked via `meta_social_technologies` MCP on 2026-09-29:
- App `Motion` exists, role `admin`, caller_permissions `["read","manage"]`, `app_status: dev_mode`, `is_live: false`
- Compliance: `compliant`, no open violations
- Webhooks: `[]` (none configured)
- App Review: `NO_SUBMISSION`, `can_submit: true`, but missing `privacy_policy` + business verification
- Contact email `nitish@rothenhall.com` unverified

## 1. Dashboard basics (developers.facebook.com/apps/1671903081190592)
1. Settings > Basic:
   - Privacy Policy URL, Terms of Service URL, Data Deletion URL, Support URL, App Icon, Category — REQUIRED before Review / Live.
   - Verify contact email.
   - Add domains in App Domains + `https://<your-domain>/` in Website platform.
2. Business verification (to go Live + advanced permissions).

## 2. Products to add
- Facebook Login for Business (or Facebook Login) — OAuth for Pages + IG
- Webhooks — subscribe `page` + `instagram`
- Instagram Platform / Instagram Graph API
- Threads API

## 3. Permissions to request (Login + App Review)
These are exactly the scopes the code asks for (`backend/src/auth.controller.ts`). Each needs Advanced Access through App Review, with a screencast, before it works for accounts without a role on the app.
- Facebook: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement` (reply to comments as the Page), `pages_manage_metadata` (subscribe the Page to webhooks), `pages_messaging` (comment-to-DM), `pages_read_user_content`, `read_insights`
- Instagram (Instagram Login): `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages`, `instagram_business_manage_insights`
- Threads: `threads_basic`, `threads_content_publish`, `threads_manage_insights`
- Creator Marketplace (Creators tab, `backend/src/creators/`): `instagram_creator_marketplace_discovery` (search + insights, needs Advanced Access; standard access returns test data), plus `instagram_basic`, `pages_show_list`, `business_management`. Discovery calls use the Page token of a `facebook_page` channel linked to an Instagram business account whose brand is eligible/onboarded to the marketplace. Until then the tab shows labelled sample creators. `instagram_creator_marketplace_messaging` is separate and only needed for in-app brand-to-creator outreach.

Request flow: dev_mode → test with admin/tester roles → screencast + use-case → App Review → Live.

## 4. Webhooks
Topics (from `list_topics`):
- `page` fields: `feed`, `mention`, `messages`, `message_reactions`, etc.
- `instagram` fields: `comments`, `live_comments`, `mentions`, `messages`, `messaging_handover`, etc.
- Threads: has a `replies` webhook (needs `threads_read_replies` and business verification). Motion doesn't handle it yet.

Subscribe when backend is public HTTPS:
```
POST /webhooks/meta  (verify token = META_WEBHOOK_VERIFY_TOKEN)
callback_url = https://<ngrok-or-domain>/webhooks/meta
page fields: feed,messages,mention
instagram fields: comments,messages,mentions
```
Each account must also be subscribed to the app. Motion does this on every connect: `POST /{page-id}/subscribed_apps?subscribed_fields=feed,messages` (Page token) and `POST graph.instagram.com/me/subscribed_apps?subscribed_fields=comments,messages`. IG comment webhooks only arrive once the app is Live, with Advanced Access, for public accounts.

MCP has `devtools_webhook_manage/subscribe` (requires live HTTPS + verify token). This repo implements `GET /webhooks/meta` verification + `POST /webhooks/meta` handler ready for that step.

## 5. Tokens
- Facebook: Facebook Login code → long-lived user token (`fb_exchange_token`) → Page tokens from `/me/accounts`.
- Instagram: Instagram Login (`instagram.com/oauth/authorize`) → `api.instagram.com/oauth/access_token` → `ig_exchange_token`; refreshed with `ig_refresh_token`. Uses `META_IG_APP_ID` / `META_IG_APP_SECRET`.
- Threads: `threads.net/oauth/authorize` → `graph.threads.net/oauth/access_token` → `th_exchange_token`; refreshed with `th_refresh_token`. Uses the Threads app's own ID and secret: `META_THREADS_APP_ID` / `META_THREADS_APP_SECRET` (Dashboard > Use cases > Threads API > Settings). Add the Threads redirect URI there too.
- Stored encrypted in `SocialAccount.accessToken`. Refreshed nightly before expiry.

## 6. Publishing limits (from docs)
- IG: 2-step `POST /{ig-id}/media` → `POST /{ig-id}/media_publish`; 100 API posts / 24h (checked via `content_publishing_limit`); JPEG only for images; media must be public URL; Reels=`REELS`, Stories=`STORIES`, Carousel ≤10.
- FB Page: `POST /{page-id}/photos|videos|feed` with `scheduled_publish_time` + `published:false` for scheduling.
- Threads: `POST /{threads-user-id}/threads` → `POST /{threads-user-id}/threads_publish`; text ≤500 chars; wait ~30s before publish; check container status.
- Private replies (IG comment-to-DM): `POST /{ig-id}/messages {recipient:{comment_id}, message:{text}}` — 1 message / 7 days (Live: only during broadcast), follow-ups only within 24h of user reply.

## 7. Go-live checklist
- [ ] Privacy/ToS/Data-deletion URLs + verified email
- [ ] Products added, OAuth redirect whitelisted
- [ ] Webhooks subscribed + verified
- [ ] Test users post + comment + DM in dev_mode
- [ ] Screencasts for each permission
- [ ] Submit Review → switch Live
