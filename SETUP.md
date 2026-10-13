# Surprisingly Good Sets — setup (Flying Fish)

Standalone VOD + live platform with one brand shell, a page per show, chat, emoji reactions,
age-verified registration and a server-enforced points system.

## Files
| File | What it is |
|---|---|
| `index.html` | Home: hero (live > featured > latest), shows grid, latest sets, top fans, how to earn |
| `channel.html?c=<slug>` | One show: logo, colours, live banner, coming up, episodes |
| `watch.html?v=<id>` | Player (Bunny / Cloudflare live or VOD / YouTube / Vimeo), chat, reactions, earning meter |
| `rewards.html` | Balance, streak, catalogue, leaderboard, your activity |
| `admin.html` | Site look, earning rules, shows, videos, rewards, redemptions, fans (CSV) |
| `netlify/functions/ff.js` | The only thing that can award or spend points. No npm dependencies. |
| `firestore.rules` | Security rules — paste into Firebase |
| `config.js` | Firebase web config — fill in |

## 1. Firebase (new project — keep Flying Fish data separate)
1. console.firebase.google.com → **Add project** (e.g. `flyingfish-sgs`).
2. **Build → Authentication → Get started → Sign-in method → Email/Password** → enable, and also enable **Email link (passwordless sign-in)**.
3. Authentication → **Settings → Authorized domains** → add the Netlify domain and the custom domain.
4. **Build → Firestore Database → Create database** (production mode, region `europe-west` or `africa-south1` if offered).
5. Firestore → **Rules** → paste `firestore.rules` → Publish.
6. Project settings → **Your apps → Web app (</>)** → copy `apiKey`, `authDomain`, `projectId`, `appId` into `config.js`.
7. Project settings → **Service accounts → Generate new private key** → downloads a JSON. Keep it private.

## 2. Netlify (new site)
1. Drag the whole folder (or the zip contents) onto Netlify, same as the other tools.
2. Site settings → **Environment variables**, from the service-account JSON:
   - `FIREBASE_PROJECT_ID` = `project_id`
   - `FIREBASE_CLIENT_EMAIL` = `client_email`
   - `FIREBASE_PRIVATE_KEY` = `private_key` (paste the whole thing including `-----BEGIN PRIVATE KEY-----`; the `\n`s are fine)
3. Redeploy after adding env vars (functions only read them at deploy).

### Sign-in emails (Resend)
Firebase's free plan only sends a few sign-in emails a day. Add these Netlify env vars and the site sends its own branded emails through Resend instead (no daily cap):
- `RESEND_API_KEY` — from the Resend account
- `RESEND_FROM_EMAIL` — a sender on a domain verified in Resend, e.g. `Surprisingly Good Sets <hello@discovr.tv>`
- optional `ALLOWED_HOSTS` — extra domains allowed as sign-in return addresses (comma-separated); the site's own domain is always allowed
Without them the site falls back to Firebase's own (capped) email.

## 3. Make yourself admin
1. Open `/admin`, sign in with your email link.
2. It shows your user ID. In Firestore create collection `admins`, document ID = that ID, field `email` = your email.
3. Reload `/admin`.

## 4. Load content
1. **Site** tab: name, logo URL, colours, points name, legal line, privacy + terms URLs.
2. **Channels** tab: one per show, each with its own logo URL and colour.
3. **Videos** tab, one per episode:
   - Bunny: Video ID = the video GUID, plus the library ID (same as current Bunny workflow).
   - Cloudflare live: Video ID = the **32-character live input UID** (not the stream key). Tick **LIVE NOW** when the show starts, untick when it ends. The studio pushes to the same live input as today.
   - YouTube / Vimeo: just the ID.
   - Tick **Published** to show it.
4. **Rules** tab: points values and caps. **Redemptions** and **Prizes** start OFF.
5. **Rewards** tab: unlocks (emoji packs `pack:gold`, fan-exclusive sets with any key) and prizes.

## How points are protected
- Browsers can't write points, ledgers or the leaderboard (rules deny it). Only `ff.js` can, with the service account.
- Watching: the page reports every 60s only if the player says it's **playing** and the tab is **visible**. The server ignores reports closer than 50s apart for that person across **all** sets — five tabs earn the same as one.
- Per-set daily minute caps, a daily total cap, chat/reaction gaps and daily limits — all editable in **Rules**.
- Fan-exclusive sets keep their real video ID in an admin-only collection; the server hands it over only to fans who unlocked it.
- Under-18s are refused at sign-up and nothing is stored for them; an age gate also shows to every visitor.

## Before switching on prize redemptions
Prize redemptions make this a promotional competition (Consumer Protection Act s36). Get Flying Fish / AB InBev legal to sign off the rewards terms, publish them, put the URL in **Site → Rewards terms URL**, then turn on **Prizes**.

## Known limits (v1)
- Bunny play/pause detection relies on Bunny's player.js support; if it doesn't respond, that set earns at half the normal cap ("unknown" state). Check one Bunny set after deploy: the meter should say "Paused" until you press play.
- Logos/images are URLs (Bunny Storage works) — no upload box yet.
- No reminder emails yet; registration uses Firebase's own sign-in emails.
