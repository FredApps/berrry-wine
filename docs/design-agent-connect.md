# Connect an Agent: pair any AI agent to a running game over WebRTC

Status: DESIGN. Builds on [design-agent-control.md](design-agent-control.md)
(the command protocol, `lib/agent-remote.js`, `tools/ctl.js`) and on
[virtual-lan-party.md](virtual-lan-party.md) (`lib/vlan-rtc.js`: WebRTC
through the berrry store, secretbox envelopes).

## The problem

An agent can drive a page today only if `tools/dev-server.js` serves the page and the
agent is on the same machine, or if the user pastes a console snippet. Neither works
for someone playing on berrry.app on their phone who wants *their own* agent to play
along, whichever agent that is. This design makes it a Start-menu feature:

- **Any agent:** Claude, Codex, Gemini, Cursor, OpenHands, a home-made script.
  Nothing is vendor-specific and nothing depends on MCP.
- **Nothing to install:** the agent reads plain instructions from the website (an
  [Agent Skills](https://agentskills.io) folder) and downloads one script itself,
  the way it would follow any README.
- **One paste:** the player copies one link into the agent. Nothing is pasted back.
- **No player account:** the agent registers itself through berrry's existing
  self-serve nomcp agent registration, and the page never writes to berrry.
- **Peer to peer:** commands and screenshots travel over a WebRTC DataChannel and
  never touch berrry.

## TL;DR

```
  PLAYER (phone / PC, no account)                              ANY AGENT
  ════════════════════════════════                             ═════════
  Start ▸ 🤖 Connect Agent...
  ┌─ Connect an Agent ─────────────────────┐
  │ Give this to your AI agent:            │  ① the ONLY paste
  │ Play my game: https://wine-assembly.   │ ──────────────────────────────►  reads SKILL.md
  │ berrry.app/skills/wine-assembly-       │   the #wa1… part never           (plain markdown)
  │ connect/SKILL.md#wa1.Qm9v…             │   reaches a server
  │ [Copy] [Share]           ⏱ 9:42        │                                  curl scripts/
  │ ☑ see screen ☑ mouse/keys              │                                  wine-agent.mjs
  └────────────────────────────────────────┘                                  node … 'wa1…' &
     wa1 = mailbox id │ 256-bit key │ page offer (ICE + DTLS fingerprint)          │
                                                                                   │ answer, sealed
                         ┌───────── BERRRY (wine-assembly app data) ─────────┐     │ + bot-signed
                         │ agentpair:<id>  public · ≤2KB · ciphertext only   │◄────┘ ② POST as bot
                         └───────────────────────────────────────────────────┘
        ③ page polls (anonymous read), opens with key, verifies sig ▲
  ┌────────────────────────────────┐
  │ 🤖 wanderbot · key 7f3a…       │ ④ consent
  │ runs as "Codex CLI" (unverified)│
  │ [Allow]  [Deny]                │
  └────────────────────────────────┘
  ══════════ ⑤ WebRTC DataChannel 'agent' (DTLS, direct P2P) ══════════   bridge on
      {id, action, args} ◄──── click · key · type · step · png ─────     127.0.0.1:<port>
      {id, ok, value}    ────► snapshots, screenshots ─────────────►         ▲
                                                                             │ curl
  ╔════════════════════════════════╗  tray [🤖] blinks per command        the agent
  ║  game           [🤖 Take back] ║  modes: drives │ watch only │ paused
  ╚════════════════════════════════╝  the page enforces permissions

  BERRRY CHANGES: 1 accept Bearer brry_rw_ on /api/data · 2 data:rw scope, one app
                  3 app context without cookies (verify) · 4 bot write limits
                  optional: 5 TTL · 6 service doc · 7 push · 8 HTTP relay (tier 2)
```

---

## 1. UI design

### Entry point

```
 ┌─────────────────────────┐
 │▌ 💾 Add a Game...        │
 │▌──────────────────────── │
 │▌ 📄 Read Me              │
 │W 🎮 Apps                 │
 │i ...                     │
 │n──────────────────────── │
 │e ● Record Screen         │
 │  🤖 Connect Agent...     │  ← new, next to Record Screen (both are "session" tools)
 │A──────────────────────── │
 │s 🔧 Debug Mode           │
 │m ...                     │
 └─────────────────────────┘
```

In `body.single-app` mode the Start menu is hidden while an app runs, so the dialog
also opens from the tray icon's menu and stays reachable mid-game.

### Dialog: state 1 of 3, "Pair"

```
 ┌─ Connect an Agent ─────────────────────────────────[?][x]┐
 │  🤖  Let an AI agent see and play this session.          │
 │                                                          │
 │  Give this to your agent (any AI agent that can run      │
 │  commands):                                              │
 │  ┌──────────────────────────────────────────────────┐   │
 │  │ Play my game: https://wine-assembly.berrry.app/  │   │
 │  │ skills/wine-assembly-connect/SKILL.md#wa1.Qm9v…  │   │
 │  └──────────────────────────────────────────────────┘   │
 │                       [ Copy ]  [ Share ]  ⏱ 9:42       │
 │                                                          │
 │  Agent may:  [x] see the screen                          │
 │              [x] use mouse and keyboard                  │
 │              [ ] run page code (eval)   (?debug only)    │
 │                                                          │
 │  ◌ Waiting for an agent…                     [ Cancel ]  │
 │  ? Already installed the skill? Just give it: wa1.Qm9v…  │
 └──────────────────────────────────────────────────────────┘
```

- **Copy** copies the whole sentence, so the one paste is also the instruction.
- **Share** (`navigator.share`) is the phone path: the player is on the phone and the
  agent is on a laptop, so the link has to leave the phone somehow. There is no QR code,
  since a laptop can't usefully scan one.
- The last line covers agents that installed the skill once: they need only the
  bare `wa1.…` token.
- The page enforces the permission checkboxes (`execEntry` refuses a disallowed
  verb). The agent never enforces them.

### Dialog: state 2 of 3, "Request"

```
 ┌─ Connect an Agent ──────────────────────────────────[x]┐
 │  🤖  wanderbot wants to connect.                        │
 │      key 7f3a·c91e·04b2   (new agent)                   │
 │      says it runs as: Codex CLI   (unverified)          │
 │      via the link you created 1 min ago                 │
 │                                                         │
 │      It will be able to: see the screen,                │
 │                          use mouse and keyboard         │
 │                                                         │
 │  [ ] Remember this agent on this device                 │
 │                               [  Allow  ]  [  Deny  ]   │
 └─────────────────────────────────────────────────────────┘
```

The name and key come from the bot's signature inside the sealed answer (see Storage),
and only the key is trusted. The "runs as" label is self-reported, shown as a
convenience, and marked as such. A remembered key shows "(known since Sep 30)".

### Dialog: state 3 of 3, "Connected", plus live indicators

```
 ┌─ Agent: wanderbot ──────────────────────────────────[_]┐
 │  ● Connected · direct · 38 ms                           │
 │  Last action: click 120,88   2s ago                     │
 │                                                         │
 │  (•) Agent drives, my input is paused                   │
 │  ( ) Watch only, agent can see but not touch            │
 │  ( ) Paused, stop the world (frozen mode)               │
 │                                    [ Disconnect ]       │
 └─────────────────────────────────────────────────────────┘

 while the agent drives:

 ╔═══════════════════════════════════════════════════════╗
 ║                                    ┌───────────────┐  ║
 ║          (game)                    │🤖 Take back ✋│  ║
 ║                                    └───────────────┘  ║
 ╚═══════════════════════════════════════════════════════╝

 taskbar tray:  [🤖] ← blinks on every agent command; click = reopen dialog
```

- "Take back" is the existing `user-input on` path in `lib/agent-remote.js` (input
  exclusivity). It doesn't disconnect, and the agent receives `{event:'user-took-input'}`.
- Esc is **not** a take-back key, because games use Esc.
- Closing the dialog minimizes it to the tray. Reloading or closing the page ends the
  session, and a new link is needed.

---

## 2. What the agent reads: the skill

### Site layout

```
 https://wine-assembly.berrry.app/
 ├── llms.txt                          GENERATED by berrry from the app's root SPEC.md
 │                                     (its "Specification" section). So we don't upload
 │                                     an llms.txt: SPEC.md carries a "For AI agents"
 │                                     section pointing at skills/…/SKILL.md
 └── skills/wine-assembly-connect/     an Agent Skills folder: installable, or just readable
     ├── SKILL.md                      frontmatter + the steps (below)
     ├── scripts/
     │   ├── wine-agent.mjs            the bridge: one file, WebRTC bundled (tier 1)
     │   └── SHA256SUMS.txt            `shasum -a 256 -c -` input. It's .txt because the
     │                                 deploy's extension filter ships only known types
     ├── bin/                          later: prebuilt bridge per OS (tier 1b)
     │   └── wine-agent-{darwin-arm64,linux-x64,win-x64.exe}
     └── reference/
         ├── api.md                    full bridge endpoint list (loaded on demand)
         └── playing.md                coordinates, timing, per-genre tips

 repo root AGENTS.md stays as it is: it is about working ON the repo, and is unrelated.
```

The name is `wine-assembly-connect`, not `connect`, so it can't collide with other skills
in an agent's installed set. The folder is plain static files in this repo, deployed
with the site.

### SKILL.md, in outline

```markdown
---
name: wine-assembly-connect
description: Connect to and play a Windows 98 game or app running in someone's
  browser on wine-assembly.berrry.app. Use when given a link or token starting "wa1.".
---
# Connect to a wine-assembly game

The token is the part after `#` in the link you were given (starts `wa1.`). It's a
secret: don't post it anywhere. It expires in 10 minutes and works once.

## Which tier are you?
- You can run shell commands and `node --version` is 18+  → Tier 1
- You can run shell commands, no node                     → Tier 1b (not yet available)
- You can only fetch URLs                                  → Tier 2 (not yet available);
  tell the user you cannot connect, and why.

## Tier 1
1. curl -fsSLO https://wine-assembly.berrry.app/skills/wine-assembly-connect/scripts/wine-agent.mjs
   check: shasum -a 256 wine-agent.mjs  →  <hash>
2. node wine-agent.mjs 'wa1.…'   (keep it running, e.g. in the background)
   expected output, first run only:  REGISTER http://127.0.0.1:PORT/register  (a puzzle)
   expected output, always:          READY http://127.0.0.1:PORT  key=<secret>
3. Wait for the player to click Allow  →  GET /status says "connected".
4. Loop: GET /screenshot.png → look → POST /click … → GET /screenshot.png …
Every request needs the header  Authorization: Bearer <secret from READY>.

## How to play well
(short version of reference/playing.md: coordinates are guest-screen pixels;
screenshot after every action; use /frozen + /step for timed games; press and
release as separate requests with a step between for games that sample the mouse
once per frame; stop and ask the player if a dialog you don't understand appears)
```

The instructions are imperative steps, each with its expected output, so an agent can
tell success from failure without guessing. No vendor names and no tool-call syntax.

### Capability tiers

```
 TIER 1   shell + node ≥18   wine-agent.mjs      WebRTC P2P      prototype scope
 TIER 1b  shell, no node     prebuilt binary     WebRTC P2P      later (bun --compile)
 TIER 2   fetch URLs only    berrry HTTP relay   via berrry      later, berrry change 8
                             (GET-only commands, since many web agents can't POST)
```

### The bridge's local API (tier 1)

The bridge listens on `127.0.0.1` only, on a random port, and requires the bearer secret
it prints at startup (so a web page in the user's own browser can't reach it through
DNS rebinding or a cross-site request). It rejects any Host header other than
`127.0.0.1:<port>`.

```
 GET  /status                 → {state: waiting|asking|connected|closed, bot, rtt}
 GET  /register               → the nomcp captcha puzzle (first run only)
 POST /register               {answer, username}           username must end in "bot"
 GET  /screenshot.png         → image/png (guest screen, native resolution)
 GET  /snapshot               → windows, focus, last MessageBox text, app, frozen, step
 POST /click                  {x, y, button?}      POST /dblclick  {x, y}
 POST /mouse                  {x, y, down|up|move}
 POST /key                    {vk}                 keydown + keyup
 POST /type                   {text}               keydown/keypress/keyup per char
 POST /drag                   {x1, y1, x2, y2}
 POST /frozen                 {on}                 POST /step {n}
 GET  /apps                   POST /launch {app}
 POST /cmd                    {raw}                any --input action, the escape hatch
 POST /disconnect
```

Each endpoint maps one-to-one onto the existing command vocabulary in
[design-agent-control.md](design-agent-control.md), so `reference/api.md` and
`tools/ctl.js` describe the same verbs.

---

## 3. Storage design

### What lives where

```
 ┌───────────────────────┬──────────────────────────────┬────────────┬───────────────┐
 │ where                 │ what                         │ written by │ lifetime      │
 ├───────────────────────┼──────────────────────────────┼────────────┼───────────────┤
 │ link #fragment        │ wa1 token: id, key, offer    │ page       │ 10 min, 1 use │
 │ berrry app data       │ agentpair:<id> sealed answer │ agent bot  │ until opened  │
 │ site (static)         │ skills/…, SPEC.md→llms.txt   │ deploy     │ per release   │
 │ agent disk            │ bot identity, session, script│ bridge     │ persistent    │
 │ page localStorage     │ known agents, perms          │ page       │ per device    │
 │ page memory           │ RTCPeerConnection, key       │ page       │ page lifetime │
 └───────────────────────┴──────────────────────────────┴────────────┴───────────────┘
```

### The token (page → agent, the single paste)

The page's offer travels inside the token, which is why the page never writes to berrry.
A full SDP is 1-3 KB, but only a few fields matter, so the token carries a minimal
binary encoding, and the bridge re-expands it into a standard SDP:

```
 wa1.<base64url of>
 ┌────┬──────────┬──────────┬────────┬───────────┬──────────┬──────────────┬─────────────┐
 │ver │mailbox id│   key    │expires │ ice-ufrag │ ice-pwd  │ DTLS sha-256 │ candidates  │
 │ 1B │   16B    │   32B    │  4B    │   ≤8B     │  ≤24B    │     32B      │ n × 7B      │
 └────┴──────────┴──────────┴────────┴───────────┴──────────┴──────────────┴─────────────┘
   candidate = type(1: host/srflx/relay) + IPv4(4) + port(2); IPv6 later
   ≈ 150 B for 3 candidates → ≈ 200 chars of base64url
```

- The token sits in the URL **fragment** (`#wa1.…`). Browsers and HTTP clients never send
  a fragment, so fetching `SKILL.md` doesn't leak it to berrry, Cloudflare or any log.
- `mailbox id` and `key` are fresh random bytes per pairing. The key is used directly
  (secretbox, 32 bytes), with no derivation: at 256 bits, offline guessing of a copied
  record is impossible.
- The page's DTLS fingerprint is in the token, so the bridge verifies it is talking to
  *that* page. There's no man in the middle even if berrry were hostile.
- The page gathers ICE (host + STUN srflx) *before* showing the link, so there is no
  trickle ICE. It reuses `gathered()` from `lib/vlan-rtc.js`.
- The token will sit in the agent's chat transcript. That's acceptable: it expires,
  the page's `RTCPeerConnection` accepts one answer, and even a live token that got
  captured still has to get past the Allow button.

### The answer record (agent → page, via berrry)

```
 berrry app data, app = wine-assembly, owner = the agent's bot user
 key:        agentpair:<mailbox id, hex>         visibility=public
 value:      { v: 1, iv: <24B b64url>, ct: <b64url> }         ≤ 2 KB
 ct = secretbox(key, {
        answer:  { ufrag, pwd, fingerprint, candidates }   (same minimal encoding)
        bot:     { username: "wanderbot", pub: <ed25519 hex>, runsAs: "Codex CLI" }
        sig:     ed25519(bot secret, "wa1-answer|" + mailbox id + "|" + answer fingerprint)
      })
```

- The page finds the record with `GET /api/public-data/users/agentpair:<id>` (an anonymous
  read that already exists; `SignalingClient.publishers()` in `lib/vlan-rtc.js` already
  handles the Cloudflare `fresh=` cache-busting). It doesn't need the bot's user id.
- Anyone could publish under that key, but nobody can guess `<id>` without the token, and
  nobody can make a record that opens without the key. The page takes the first one that
  opens *and* verifies.
- The signature binds the bot's long-lived key to this one handshake. That's what makes
  "wanderbot · key 7f3a…" verifiable and "Remember this agent" meaningful. `runsAs`
  is inside the signed envelope but is still only the bot's own claim.
- The bridge sends `DELETE /api/data/agentpair:<id>` once the channel opens. A record
  orphaned by a failed pairing lingers until TTL (optional change 5). The page ignores
  records for expired tokens, so an orphan is garbage and never a hazard.

### Agent disk (written by the bridge)

```
 ~/.config/wine-agent/identity.json   (0600)
   { username: "wanderbot", ed25519: { pub, secret }, registeredAt }
 ~/.config/wine-agent/session.json    (0600)
   { token: "brry_rw_…", expiresAt }   ← nomcp /auth/sign-in, 24h, refreshed silently
```

The first run has no identity, so the bridge prints `REGISTER …` and serves the nomcp
captcha puzzle at `GET /register`. The agent solves it and `POST`s the answer. That's
the flow berrry's nomcp registration was built for, and it doesn't assume any
particular agent.

### Page localStorage (conveniences only, every access in try/catch)

```
 wa.agent.known         [{ pub, username, firstSeen, lastSeen }]   ("Remember this agent")
 wa.agent.perms         last checkbox state
```

An empty or blocked store only means "(new agent)" and default checkboxes.

### The wire (after pairing)

```
 RTCDataChannel 'agent', ordered + reliable (commands must not reorder)
   bridge → page   {id, action, args}        | [ ...array = a stream, as today ]
   page   → bridge {id, ok, value}
   page   → bridge {event: 'user-took-input' | 'mode' | 'app-launched' | 'bye', ...}
   large replies (png): {id, chunk: i, of: n, data}  16 KB frames, reassembled by id
```

This is the same protocol as the dev-server hub. The only change in `lib/agent-remote.js`
is a transport seam, `HubPoll | RtcChannel`, in front of the existing `execEntry`, so
frozen mode, `step`, `record`, `user-input` and `launch` all carry over.

---

## 4. Required berrry changes

Scope: `../berrry-server`. Nomcp self-serve registration (`src/nomcp.js`:
`/register/challenge`, `/register/solve`, `/auth/sign-in`) and the app data store
(`src/backend-api/routes.js`: `/api/data/*`, `/api/public-data/*`) both exist. The gap is
that they don't connect:

```
 nomcp session token  brry_rw_…  ──►  /api/nomcp/<token>/*   ✅ (tokenAuth, api_keys lookup)
                                 ──►  /api/data/*            ❌ authenticateToken only
                                                                 accepts a JWT
```

### Required (tier 1)

**1. `authenticateToken` accepts an API key as a Bearer token.**
`src/unified-auth-middleware.js`: when the Bearer value parses as `brry_rw_…`, look it
up in `api_keys` with the same query nomcp's `tokenAuth` uses. Factor that query into one
shared function, so "valid, unrevoked, unexpired, user not disabled" has a single
definition. Then set `ctx.state.user` the same way the JWT path does, plus
`ctx.state.viaApiKey = { id, scopes, app_id }`.

**2. A data scope, checked on the data routes.**
Session tokens from `/auth/sign-in` carry `['apps:read','apps:write']` today. Add
`data:rw`, and have `/api/data/*` require it **when the caller came in via an API key**
(the JWT path is unchanged). A key with `api_keys.app_id` set is limited to that app.
The column already exists.

**3. App context for a non-browser caller.**
The bridge calls `https://wine-assembly.berrry.app/api/data/agentpair:<id>` from Node,
with no cookies. `requireAppContext` must resolve the app from the Host subdomain alone.
**Verify first**, because it may already work.

**4. Abuse limits for bot writes.**
A per-key rate limit on `/api/data` writes (e.g. 30/min) and a value-size cap for API-key
callers (2 KB is plenty here). Bots are cheap to register behind a captcha, so this
bounds what one bot can do to one app's store.

### Optional

**5. Record TTL:** `POST /api/data/:key?visibility=public&ttl=600`, so orphaned
`agentpair:*` records vanish on their own.

**6. Service document:** mention the data API and the `data:rw` scope in the nomcp HTML
service document, so generic agents discover it.

**7. Push instead of poll:** the page polls `public-data/users/agentpair:<id>` about once a
second for at most 10 minutes per pairing. An SSE endpoint for a single key would remove that.

**8. HTTP relay (tier 2, for fetch-only agents):** `GET /api/relay/<id>/<verb>?…`, a
capability-URL command queue. The page long-polls it and the agent issues GETs, with
screenshots stored briefly for the agent to fetch. This is the dev-server hub moved to production.
It carries every screenshot through berrry, so it needs its own bandwidth and abuse
limits. It's deliberately out of the prototype.

### Not needed

- No player auth change: the player stays anonymous.
- No wine-assembly-specific code on berrry: changes 1-4 read as "nomcp agents can
  use an app's data API", which any berrry app can use.
- No TURN server for v1 (see Open questions).

### Local development mirror

`tools/dev-server.js` already implements `/api/data` and `/api/public-data` in memory with
no login. It gains one rule: accept any `Bearer brry_…` as a fixed test bot user. The whole
pairing then runs on one machine with no berrry account and no network.

---

## 5. Pieces to build

```
 [1] lib/agent-pair.js       token + minimal-SDP pack/unpack, seal/open, sig verify.
                             Pure functions, shared by the page and the bridge
 [2] tools/dev-server.js     Bearer brry_* test bot on the in-memory store
 [3] skills/wine-assembly-connect/scripts/wine-agent.mjs
                             source in tools/wine-agent/, bundled (werift + [1]) into one
                             file; nomcp register/sign-in; localhost API (section 2)
 [4] lib/agent-remote.js     transport seam: HubPoll (existing) | RtcChannel (new)
 [5] index.html              Start item, 3-state dialog, frame + "Take back" pill, tray
 [6] skills/…/SKILL.md, reference/*.md, /llms.txt
 [7] tools/deploy-berrry.js  include skills/ and llms.txt in the deploy set (verify: it
                             walks lib/ and src/ today)
 [8] tools/ctl.js            -s rtc:wa1.… reuses [3] (developer path)
 [9] tests                   test-agent-pair.js: token/SDP/seal round-trips, no browser
                             test-web-agent-connect.js: puppeteer page + bridge against the
                             dev-server mirror, SKILL.md steps followed literally,
                             click → screenshot round trip
```

Prototype order: [1] → [2] → [3] against a puppeteer page → [4] → [5] → [6] → berrry 1-4.
Everything up to [6] runs on the dev-server mirror before any berrry change lands.

### Status (2026-09-30): [1]-[7] and [9] built, [8] not started

```
 lib/agent-pair.js            [1]  token, minimal SDP, seal/open, frames
 tools/dev-server.js          [2]  /api/nomcp/* mirror + Bearer brry_ on /api/data
 tools/wine-agent/            [3]  wine-agent.js (source), build.js (esbuild → one file,
                                   --check), size-report.js; own package.json, so the
                                   repo root's node_modules is never touched
 skills/…/scripts/            [3]  wine-agent.mjs 1033 KB (werift 459 KB of it) + sums
 lib/agent-connect.js         [4]  the page side, a controller the UI only views. [4]
                                   became a new module rather than a transport seam in
                                   agent-remote.js: that file only gained runCommands()
                                   and commandNeeds()
 lib/agent-connect-ui.js      [5]  the dialog, the tray 🤖, the Take back pill; loaded
                                   on first click. index.html gained one Start item
 skills/…/SKILL.md, reference/ [6] plus root SPEC.md (→ llms.txt)
 tools/deploy-berrry.js       [7]  ships skills/ (.md .mjs .txt)
 test/test-agent-pair.js      [9]  8 checks, no browser
 test/test-web-agent-connect.js    35 checks: real Chrome ⇄ the shipped bridge over a
                                   real DataChannel, via the controller API and then
                                   through the Start menu; screenshots in
                                   build/agent-connect/
```

Decisions made while building, which the sections above don't show:

- **Drive mode takes the input on the agent's first control command.** `agent-connect.js`
  decides that per command. `agent-remote.js`'s auto-engage is one-shot per page: a
  manual Take back retires it for the page's life, so a second session would otherwise
  never block the player's input.
- **The bridge waits 300 ms before closing its peer connection** on `/disconnect`.
  Closing immediately dropped the queued `bye`, and the page then waited out an ICE
  timeout before it noticed.
- **The public row's owner fields name the bot.** That's store metadata, not ours to
  hide. It's readable only by someone who already holds the token (the record key
  derives from it), and the sealed `value` itself carries nothing readable.
- **Chrome ⇄ werift interop works with Chrome's mDNS host candidates** on one machine.
  Across two machines on different networks it's still unmeasured (open question 1).

A useful acceptance test for [6]: give a *different* agent than the one that wrote it
nothing but the pasted sentence, and see if it gets to a screenshot.

## 6. Security summary

| Threat | Why it fails |
|---|---|
| Someone reads the berrry record | ciphertext under a 256-bit key that only the token holds |
| Token leaks via server logs | it lives in the URL fragment, which is never sent |
| Someone guesses the mailbox id | 128 random bits; and an answer they write can't be sealed |
| MITM on the DataChannel | the page fingerprint is in the token, and the bridge fingerprint is in the sealed answer |
| Token leaks (chat log) after use | one answer per peer connection, 10 min expiry |
| Token leaks before use | the player still has to Allow a bot name and key they don't recognize |
| A web page drives the local bridge | 127.0.0.1 only, random port, bearer secret, Host check |
| Tampered bridge script | sha256 in SKILL.md; the skill folder deploys as one unit |
| Agent overreach | page-side permission checks; eval off outside `?debug`; Take back / Disconnect |
| Bot spam in the store | captcha registration + per-key limits (berrry change 4) |

## 7. Open questions

- **Symmetric NAT on both ends** (some cellular carriers): host + STUN candidates won't
  connect, and it needs TURN. That's measured on first real use; the fallback is a
  berrry-hosted TURN with short-lived credentials.
- **`werift`** (pure-JS WebRTC, no native build, safe on the M1/x64 Node split) vs
  `node-datachannel` (native, faster). Pure JS is the default, because the bridge has to
  be a single downloadable file.
- **Bundle size** of `wine-agent.mjs` with werift inlined: measured at 1033 KB minified
  (werift 459 KB, then its x509/asn1 dependencies). That's a comfortable curl, so tier 1b
  isn't urgent. `tools/wine-agent/size-report.js` shows what could be stubbed.
- **Reconnect without a new link** (the same remembered agent after a page reload) needs
  the page to publish something, so it needs a player login or change 7. Deferred.
