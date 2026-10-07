# Motion runbook

For the person who runs Motion for the agency. Plain steps you can copy. Commands are for Windows PowerShell and Docker, run from
the project folder (where `docker-compose.yml` is). The API examples use `Invoke-RestMethod`, which works in Windows PowerShell 5.1.

Contents: [Deploy or upgrade](#1-first-deploy-or-upgrade) | [Onboard a client](#2-onboard-a-new-client) | [Everyday tasks](#3-everyday-tasks) |
[Backups, restore, rollback](#4-backups-restore-and-rollback) | [Settings](#5-environment-variables) | [Monitoring](#6-monitoring) |
[Troubleshooting by error code](#7-troubleshooting-by-error-code)

Related: `docs/security-review.md` (what was checked and what is still open) and `docs/admin-client-plan.md` (the design).

## 1. First deploy or upgrade

You need Docker Desktop running and `backend/.env` filled in (section 5).

1. **Take a backup first.** Always, even for a small change (details in section 4):

   ```powershell
   New-Item -ItemType Directory -Force backups | Out-Null
   docker compose exec db pg_dump -U motion -Fc -f /tmp/motion.dump motion
   docker compose cp db:/tmp/motion.dump .\backups\motion-before-upgrade.dump
   ```

2. **Name your staff.** In `backend/.env` set `ADMIN_EMAILS` to the agency's email addresses, comma separated. Only staff can connect
   channels and open the admin console, and nobody is made staff by guessing. It is read when the backend starts, so restart after changing it.
   Leave `ALLOW_SIGNUP` out (sign-up stays closed; people join by invitation link).

3. **Build and start the backend** (the frontend too if the web app changed). Database changes run automatically as the backend starts:

   ```powershell
   git pull
   docker compose up -d --build backend frontend
   ```

4. **Read the log.** It should show these, in this order:

   ```powershell
   docker compose logs backend --tail 80
   ```

   - `All migrations have been successfully applied.` (or `No pending migrations to apply.` when nothing changed)
   - Upgrading an install that had no workspaces yet: `Moved existing data into client workspaces: N workspace(s), N row(s), N upload(s) recorded.`
     (appears once; every existing user now has a workspace of their own with their channels, drafts and checks in it)
   - If `ADMIN_EMAILS` named someone who was not staff yet: `Made N user(s) from ADMIN_EMAILS an admin.`
   - `Nest application successfully started` and `Motion backend on http://localhost:3001`

   Red `ERROR` lines or a restart loop mean it did not start. Most often a missing `AUTH_SECRET` or `TOKEN_ENCRYPTION_KEY`
   (the message names it) or the database is not ready. If a migration fails, do not retry blindly: go to section 4.

5. **Check it works.**

   ```powershell
   # 401 with a short message means the backend is up and asking for a sign-in
   Invoke-RestMethod http://localhost:3001/auth/me
   ```

   Then sign in on the web app as a staff member. `GET /auth/me` for that person shows `role: ADMIN` and `canActAs: true`. If it shows
   another role, their email is not in `ADMIN_EMAILS` (or you have not restarted the backend since adding it).

**A brand new, empty database.** The first account created becomes staff even with sign-up closed. Create it once, then add the rest of
the staff to `ADMIN_EMAILS`:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/register -ContentType 'application/json' `
  -Body (@{ email = 'you@youragency.com'; password = 'a-long-password' } | ConvertTo-Json)
```

After the first account exists, `/auth/register` answers 403 "Sign-up is by invitation" for everyone.

**Production notes.** Do not set `ALLOW_SIGNUP=true` on a real install: with it, anyone can register an address you listed in
`ADMIN_EMAILS` and become staff at the next restart. The compose file publishes Postgres on port 5432 with the password `motion`.
That is fine on a laptop. On a server remove the `ports:` lines under `db` and change the password. Set `TRUST_PROXY=1` when the backend
sits behind one proxy or tunnel (ngrok), or every visitor shares one sign-in rate limit.

## 2. Onboard a new client

Staff do all of this. The client never connects their own profiles.

1. **Create the client.** Admin console, Clients, New client: enter the client's name and the email of their main contact. (API:
   `POST /admin/clients` with `{ name, pocEmail }`.) The result shows an **invitation link**. Nothing is emailed: copy it and send it to
   the contact yourself, by message or email. It works once and lasts 72 hours.

   ```powershell
   $login = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login -ContentType 'application/json' -Body (@{ email = 'you@youragency.com'; password = '...' } | ConvertTo-Json)
   $h = @{ Authorization = "Bearer $($login.token)" }
   $new = Invoke-RestMethod -Method Post -Uri http://localhost:3001/admin/clients -Headers $h -ContentType 'application/json' -Body (@{ name = 'Acme Bakery'; pocEmail = 'owner@acme.example' } | ConvertTo-Json)
   $new.invite.url        # send this link; $new.client.id is the client's id
   ```

2. **The contact accepts.** They open the link, choose a password and are signed in. If the link has expired, send a new one (section 3).
3. **Connect their channels.** Open the client in the admin console, Channels tab, and connect Instagram, Facebook or Threads. You are
   sent to Meta to sign in as someone who has access to that page or account, then back to Motion. (API: `GET /auth/instagram/start`
   with the header `X-Client-Id: <client id>` returns the Meta address to open.) A channel can belong to only one client at a time.
   Meta may need app review before you can connect pages you do not own: check the Meta developer dashboard first.
4. **Set what they can use.** Features tab. Every section and action is on, except `ai`, which starts off because it costs money.
   Switch off what the client should not see. A switched-off section disappears from their menu and the server refuses it
   (`FEATURE_DISABLED`). Staff are never blocked by these switches. (API: `PUT /admin/clients/<id>/features` with `{ "analytics": false }`.)
5. **Check seats.** The default is 3 people (the contact counts). Raise it in the Team tab if they will invite more (section 3).
6. **Preview as the client.** Use Preview as client. The yellow bar shows the client's name. "View as client" is read only and shows exactly
   what they see, switches included. "Admin controls" lets you change things and ignores the switches. Exit when finished.
   Both starts and exits go in the client's Activity tab.
7. **Tell the contact** they can invite their own team from the Team page, up to the seat limit.

## 3. Everyday tasks

Each task is in the client's page in the admin console. The API form is given for when you need it (`$h` is the header from section 2).

| Task | How |
|---|---|
| Pause a client | Suspend. Their people are signed out on the next click, nothing is published, automations stop, analytics keep syncing. API: `POST /admin/clients/<id>/suspend` |
| Resume a client | Activate. API: `POST /admin/clients/<id>/activate`. An archived client must be restored first: `POST /admin/clients/<id>/unarchive`, then activate |
| Hide a finished client | Archive (nothing is deleted; it is paused and leaves the lists). Staff workspaces cannot be archived. API: `POST /admin/clients/<id>/archive` |
| Rename a client | Edit the name (2 to 80 characters). API: `PATCH /admin/clients/<id>` with `{ "name": "New name" }` |
| Send a new invitation | Team tab, Resend invitation, for someone who has not joined. A new link cancels the old one. API: `POST /admin/users/<userId>/resend-invite`. The link is in `invite.url` |
| Reset a password | Team tab, Reset link, for someone who has already joined. API: `POST /admin/users/<userId>/reset-link`, link in `reset.url`. It lasts 24 hours, works once, and signs the person out everywhere. It also clears a lockout |
| Switch a person off | Team tab, Disable. They are signed out at once and their links stop working. It frees their seat. Enable brings them back (needs a free seat). API: `POST /admin/users/<userId>/disable` or `/enable` |
| Change seats | Team tab, seats. You cannot go below the number in use (active plus invited). API: `PATCH /admin/clients/<id>/seats` with `{ "seatLimit": 5 }` |
| Disconnect a channel | Channels tab, Disconnect. Posts, numbers and comments stay; publishing, syncing and automations for it stop and its token is dropped. API: `DELETE /accounts/<accountId>` with header `X-Client-Id: <client id>` |
| Reconnect a channel | Connect the same channel to the same client again. It comes back with its history. To move it to another client, disconnect it first, then connect it there |
| Check a client's activity | Activity tab (who did what and when, newest first). API: `GET /admin/clients/<id>/audit` |
| See what needs attention | Admin overview: failed posts, disconnected channels, invitations not accepted, paused and channel-less clients. API: `GET /admin/overview` |
| Load sample data (development only) | `docker compose exec -e DEMO_SEED=yes backend node dist/scripts/seed-demo.js`. It only touches the six `@motion.test` users and their workspaces. Do not run it against a database with real clients unless you are comfortable with four extra sample workspaces |

The client's own main contact can also invite members, resend invitations and switch members off from their Team page, within the seat limit.
They cannot touch the main contact or staff.

## 4. Backups, restore and rollback

**There are no down-migrations.** If an upgrade goes wrong, you go back by restoring the backup you took before it. Anything created after that
backup is lost, so upgrade at a quiet time.

**Back up the database** (this uses a file inside the container, so PowerShell cannot damage it):

```powershell
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
docker compose exec db pg_dump -U motion -Fc -f /tmp/motion.dump motion
docker compose cp db:/tmp/motion.dump ".\backups\motion-$stamp.dump"
```

**Back up the uploaded files** (media that posts point at lives in a Docker volume):

```powershell
docker compose cp backend:/app/uploads ".\backups\uploads-$stamp"
```

Keep copies of `backend/.env` somewhere safe too. Without `TOKEN_ENCRYPTION_KEY` the stored channel tokens cannot be read and every channel
must be reconnected.

**Restore** (replaces everything in the database with the backup):

```powershell
docker compose stop backend
docker compose cp .\backups\motion-2026-10-07-0900.dump db:/tmp/restore.dump
docker compose exec db psql -U motion -d postgres -c "drop database motion with (force)"
docker compose exec db psql -U motion -d postgres -c "create database motion"
docker compose exec db pg_restore -U motion -d motion --no-owner /tmp/restore.dump
docker compose start backend
```

**Roll back an upgrade.** Restore the backup taken before it (above), then put the old code back and rebuild, so the backend does not run
the newer migrations on the old data:

```powershell
docker compose stop backend
# restore as above, then:
git checkout <the previous version>
docker compose up -d --build backend frontend
```

**Cut-over safety.** Before the first upgrade to client workspaces, restore a copy of your real backup into a scratch database and run the new
backend against it first (use a different database name and port, never the live `motion` database). Check the log lines in section 1
and sign in as staff.

## 5. Environment variables

Set these in `backend/.env` (the compose file passes them to the backend). **Secret** means never commit it, never paste it into chat or a ticket.

| Name | What it does | Secret |
|---|---|---|
| `AUTH_SECRET` | Signs sign-in sessions and the connect-channel link. At least 32 characters (`openssl rand -base64 48`). Changing it signs everyone out. The backend will not start without it | yes |
| `TOKEN_ENCRYPTION_KEY` | Encrypts stored Meta access tokens (AES-256-GCM). 32 bytes, base64 (`openssl rand -base64 32`). Keep it stable: changing it makes every channel need reconnecting | yes |
| `DATABASE_URL` | Postgres address. The compose file sets it for the backend container | yes (holds the password) |
| `ADMIN_EMAILS` | Comma separated staff emails. Made staff when the backend starts. Nobody is ever demoted from here | no |
| `ALLOW_SIGNUP` | `true` lets anyone register (demos only). Anything else, or unset, keeps sign-up closed. Never on a real install (section 1) | no |
| `FRONTEND_URL` | The web app's address. Used for invitation and reset links, for where the connect-channel flow returns to, and as the allowed browser origin (CORS). Use one address, no trailing text. Several, comma separated, work for CORS only | no |
| `PUBLIC_BASE_URL` | The backend's public address. Upload links are built from it, and Meta downloads media from it when a post goes out. If it is unreachable, scheduled posts fail | no |
| `PORT` | Backend port. Default 3001 | no |
| `TRUST_PROXY` | How many proxies sit in front (1 for ngrok). Without it all visitors behind a proxy share one rate limit | no |
| `UPLOAD_CLEANUP` | `on` lets the nightly job delete unused uploads older than the grace period. Anything else only logs what it would delete | no |
| `UPLOAD_CLEANUP_DAYS` | Grace period for the cleanup. Default 14 | no |
| `META_APP_ID`, `META_APP_SECRET` | The Meta app used for Facebook login and webhook signatures | secret: `META_APP_SECRET` |
| `META_IG_APP_ID`, `META_IG_APP_SECRET` | The Instagram login app; the secret also signs Instagram webhooks | secret: `META_IG_APP_SECRET` |
| `META_THREADS_APP_ID`, `META_THREADS_APP_SECRET` | The Threads app; the secret also signs Threads webhooks | secret: `META_THREADS_APP_SECRET` |
| `META_WEBHOOK_VERIFY_TOKEN` | The word Meta sends when you subscribe the webhook | yes |
| `META_FB_REDIRECT_URL`, `META_IG_REDIRECT_URL`, `META_THREADS_REDIRECT_URL`, `META_OAUTH_REDIRECT_URL` | Where Meta sends people back after connecting. Must match the Meta dashboard exactly | no |
| `META_GRAPH_VERSION` | Graph API version. Default `v25.0` | no |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | AI ideas, hooks and pre-flight reviews. Without the key those features answer that they are not set up | secret: the key |
| `TRIBE_SERVICE_URL`, `TRIBE_SERVICE_TOKEN` | Optional audience simulation service. Leave empty to use the AI review alone | secret: the token |
| `RATE_LIMIT` | `off` disables rate limits. For the automated tests only; never set it on a real install | no |
| `DEMO_SEED` | `yes` lets the sample-data script run. Set it only on the command that runs the script | no |

## 6. Monitoring

Read the log with `docker compose logs backend --tail 200` (add `-f` to follow, or pipe to `Select-String "failed"`).

Lines worth watching, and what to do:

| Log line contains | Meaning | Do |
|---|---|---|
| `Token refresh failed for` | A channel's token could not be renewed overnight | The channel will stop working at expiry. Reconnect it (section 3) |
| `... failed for <channel>:` (from the numbers sync) | The numbers for that channel did not update, often a missing permission | Reconnect the channel and approve every permission |
| `Automation failed for comment` / `Automation <id> failed` | A comment reply or message could not be sent | Check the channel is connected and the permission is granted |
| `Webhook subscription failed` / `Instagram webhook subscription failed` | New channel is not getting comments | Reconnect it; check the webhook settings in the Meta dashboard |
| `OpenRouter request failed` / `OpenRouter error` | The AI service did not answer | Check `OPENROUTER_API_KEY` and credit |
| `Pre-flight check <id> failed` / `Pre-flight queue error` | A check failed | The client can retry it from the check |
| `Autopilot failed for client` | The 7am idea run failed for that client | Check the AI key and that the client has a brand profile |
| `Could not record <action>` | The activity log could not be written (the action itself still happened) | Check the database; the Activity tab will be missing that entry |
| `Upload cleanup failed` | The nightly cleanup stopped | Check the uploads volume |
| `Would remove N unused uploads` / `Removed N of M unused uploads` | The nightly report. "Would remove" means `UPLOAD_CLEANUP` is not `on` | Read it, then switch cleanup on if the numbers look right |
| `ERROR [ExceptionsHandler]` | An unexpected error in a request. A burst of `PayloadTooLargeError` just means someone sent a body that was too big | Look at the line below it for the cause |

Not in the log, check in the admin overview instead: **failed posts** (the failure reason is stored on the post and shown to staff),
channels needing attention, and invitations not accepted. Publishing failures and account lockouts do not write a log line today
(listed in `docs/security-review.md`).

## 7. Troubleshooting by error code

The web app shows a plain message for most of these. The code is in the response body (`code`) and helps when you test with the API.

| Code (HTTP) | What the person sees | Cause and fix |
|---|---|---|
| `CHANNEL_ALREADY_CONNECTED` (409) | "This channel is already connected to <client>. Disconnect it there first." | A channel belongs to one client at a time. Disconnect it from the client it is on (Channels tab, or `DELETE /accounts/<id>` with that client's `X-Client-Id`), then connect it here. If it was only disconnected, not removed, connecting it to the same client brings it back |
| `SEAT_LIMIT` (400) | "This workspace has used all N seats..." | Seats count active plus invited people (not staff). Disable someone, or raise the limit: `PATCH /admin/clients/<id>/seats`. Enabling a disabled person also needs a free seat. You cannot lower the limit below the number in use |
| Locked account (401) | "Email or password is incorrect." | Five wrong passwords lock an account for 15 minutes, with the same message as a wrong password so it reveals nothing. Wait, or send a reset link (section 3): setting a new password clears the lock |
| Expired or used link (404, `INVITE_INVALID` or `RESET_INVALID`) | "This link is not valid any more. Ask your account manager for a new one." | The link was used, is older than 72 hours (invitation) or 24 hours (reset), was replaced by a newer link, or its owner was disabled. Send a new invitation (not yet joined) or reset link (already joined). Nobody can tell which case it was; that is on purpose |
| `FEATURE_DISABLED` (403, body has `feature`) | "This is not switched on for your account..." | The switch named in `feature` is off for that client. Features tab, or `PUT /admin/clients/<id>/features` with `{ "<feature>": true }`. Staff are never blocked; if staff see it, they are not signed in as staff |
| `PREVIEW_READ_ONLY` (403) | "This preview is read only. Turn on admin controls to make changes." | You are previewing in "View as client" mode. Switch to Admin controls (the preview bar), or exit the preview |
| `CLIENT_SUSPENDED` (403) | "This workspace is paused. Contact your account manager." | The client is suspended. Activate it (section 3). If it was archived, restore it first. Staff are not affected and can still preview and manage it |
| `ACT_AS_FORBIDDEN` (403) | "Not allowed." | A signed-in person who is not staff sent `X-Client-Id`. Clients can never name another client. If it happens to a staff member, they are not in `ADMIN_EMAILS` or the backend was not restarted after adding them (check `GET /auth/me` for `role`) |
| `TEAM_FORBIDDEN` (403) | "Only the main contact can manage the team." | A team member (not the main contact) opened the team page. Ask the main contact, or do it as staff from the client's Team tab |
| `CLIENT_REQUIRED` (400) | "Choose a client first." | Staff called a client route without choosing a client. Preview a client first, or send `X-Client-Id` |
| Sign-in says "Sign-up is by invitation" (403) | | Sign-up is closed. Create the person from a client's Team tab (or Create client) and send them the invitation link |
| An uploaded file is refused (400) | "Only JPG, PNG, WebP, GIF or MP4 files are allowed." or "That file does not look like a real JPG, PNG..." | The file type is checked by its first bytes, not its name. Re-export the file from the original |
| "That file is not available. Upload it again." (400) | | The link names a file uploaded for another client. Upload the file again for this client |
| Posts fail with a fetch error | | `PUBLIC_BASE_URL` is not reachable from the internet (tunnel down). Fix it and re-schedule the failed posts |
