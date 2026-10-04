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
Scheduling/publishing:
- `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`
- `instagram_basic`, `instagram_content_publish`
- `threads_basic`, `threads_content_publish`

Comments / DMs / automations:
- `instagram_manage_comments` (reply/hide/delete IG comments)
- `instagram_manage_messages` / `instagram_business_manage_messages` (private replies / comment-to-DM)
- `pages_messaging`, `pages_read_user_content`, `pages_manage_metadata` (FB comment reply + Messenger)
- If Page linked via Business Manager: `ads_management`, `ads_read`

Request flow: dev_mode → test with admin/tester roles → screencast + use-case → App Review → Live.

## 4. Webhooks
Topics (from `list_topics`):
- `page` fields: `feed`, `mention`, `messages`, `message_reactions`, etc.
- `instagram` fields: `comments`, `live_comments`, `mentions`, `messages`, `messaging_handover`, etc.
- Threads: no dedicated topic — poll `/{threads-user-id}/threads` for replies, or use IG/FB webhooks only.

Subscribe when backend is public HTTPS:
```
POST /webhooks/meta  (verify token = META_WEBHOOK_VERIFY_TOKEN)
callback_url = https://<ngrok-or-domain>/webhooks/meta
page fields: feed,messages,mention
instagram fields: comments,messages,mentions
```
MCP has `devtools_webhook_manage/subscribe` (requires live HTTPS + verify token). This repo implements `GET /webhooks/meta` verification + `POST /webhooks/meta` handler ready for that step.

## 5. Tokens
- Short-lived User token (Facebook Login, scopes above) → exchange for long-lived (~60d) → Page tokens → IG Business ID (`GET /me/accounts?fields=instagram_business_account`) → Threads User ID (`GET graph.threads.net/v1.0/me`).
- Store in `SocialAccount.accessToken`. Refresh before expiry (cron in backend).

## 6. Publishing limits (from docs)
- IG: 2-step `POST /{ig-id}/media` → `POST /{ig-id}/media_publish`; 50 API posts / 24h; media must be public URL; Reels=`REELS`, Stories=`STORIES`, Carousel ≤10.
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
