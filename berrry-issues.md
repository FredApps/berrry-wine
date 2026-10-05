# Berrry-side issues

Problems in berrry.app itself, found while running wine-assembly on it. Each
one has a workaround on our side or none; the fix belongs in Berrry.

## 1. Google / Twitter sign-in drops the return URL

**Symptom:** a player signs in from a game (for example to join a network room)
and lands on berrry.app's "My apps" instead of back in the game.

**Trace**, checked against the live site 2026-09-22:

```
wine-assembly.berrry.app/api/auth/login?return=<page>
  302 -> https://berrry.app/login?subdomain=wine-assembly&return=<page>    ok
         email/password <form method=POST action=/login> carries hidden
           redirect=<page>, subdomain=wine-assembly, return=<page>          ok
         "Sign in with Google"  -> href="/auth/google"                      return dropped
         "Sign in with Twitter" -> href="/auth/twitter"                     return dropped
  GET /login sets no cookie, so nothing carries the return address
  /auth/google -> accounts.google.com ... redirect_uri=/auth/google/callback&state=...
  callback -> default landing ("My apps")
```

**Fix:**
- Render the buttons as `/auth/google?return=…&subdomain=…` (same for Twitter).
- Keep both values across the OAuth round trip, in `state` or in a short-lived
  cookie set by `/auth/google`.
- On callback, do what the password path already does: redirect to
  `<return>?token=…` for that subdomain.

**Our workaround:** `lib/browser-shell.js` `goSignIn` saves the page URL in
sessionStorage (`wine-lan-signin-return`), so returning to the site in the same
tab resumes that page. The subdomain still is not signed in until
`/api/auth/login` runs once more. The popup path (`openSignInPopup`, returning
to `signin-done.html`) has the same problem.

## 2. API GETs are cached at the edge, identity included

**Symptom:** on 2026-09-21 one signed-in `/api/auth/user` response was served to
every visitor for hours. A signed-out page believed it was that user and never
asked anyone to sign in. Presence lists from `/api/public-data/users/<key>` also
came back stale.

**Cause:** the API answers with no `Cache-Control`, so Cloudflare caches the GETs.

**Fix:** send `Cache-Control: private, no-store` on every `/api/*` response,
and at the least on `/api/auth/*` and anything that depends on the cookie.

**Our workaround:** every GET gets a unique `?fresh=<ms>` query
(`lib/vlan-rtc.js` `SignalingClient._json`, `lib/browser-shell.js`).

## 3. `/login` throws on a relative `return`

`berrry.app/login` runs `new URL(return)`, which throws on a path such as
`/index.html?app=x`. **Fix:** resolve it against the subdomain's origin.
**Our workaround:** we always pass an absolute URL (`goSignIn`).

## 4. `PUT /api/data/<key>` answers 404 for a key never written

`PUT` does not create. Every first write of a presence record would fail.
**Fix:** make PUT an upsert, or document that POST is the create-or-replace
verb. **Our workaround:** we use POST (`SignalingClient.publish`).

## 5. Upload size limits

The deploy API refuses a file above 20 MB and a request above about 19 MB.
**Our workaround:** `tools/deploy-berrry.js` splits large binaries into parts
(StarCraft's `stardated.mpq` goes as 3), batches uploads under the limit, and
skips a few oversized debug PNGs. Nothing is broken, but a higher per-file
limit or a chunked-upload endpoint would remove the split and reassemble step.
