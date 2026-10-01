---
name: wine-assembly-connect
description: Connect to a Windows 98 game or app that a person is running in their browser on wine-assembly, then see its screen and play it with mouse and keyboard. Use when someone gives you a link containing "#wa1." or a token starting "wa1.", or asks you to play or help with their wine-assembly session.
---

# Connect to a wine-assembly game

A person is running an old Windows program (a game, usually) in their browser at
wine-assembly, and wants you to see it and play it. They gave you a link like

    https://wine-assembly.berrry.app/skills/wine-assembly-connect/SKILL.md#wa1.Qm9v…

or just the part after `#`, starting `wa1.`. That part is the **token**. It is a
one-time invitation to *their* browser tab, and it expires about 10 minutes after
they made it. Treat it like a password: don't post it anywhere or put it in a file
other people can read.

You connect by running a small bridge program on your machine. The bridge talks to
their browser directly over WebRTC and gives you a plain HTTP API on `127.0.0.1`.
Anything that can run `node` and `curl` can do this: no account, no package install,
no API keys.

**You need:** a shell, Node.js 18 or newer (`node --version`), `curl`, and outbound
internet access. If you can't run commands, tell the person that this skill needs an
agent that can run shell commands, and stop.

## 1. Get the bridge

    mkdir -p ~/.cache/wine-agent && cd ~/.cache/wine-agent
    curl -fsSLO https://wine-assembly.berrry.app/skills/wine-assembly-connect/scripts/wine-agent.mjs
    curl -fsSL  https://wine-assembly.berrry.app/skills/wine-assembly-connect/scripts/SHA256SUMS.txt | shasum -a 256 -c -

Expect `wine-agent.mjs: OK`. On Linux without `shasum`, use `sha256sum -c -`.
It is one file (about 1 MB) with its WebRTC library bundled in, and it needs no
`npm install`.

If the link the person gave you starts with a different address (a local dev server
such as `http://127.0.0.1:8080/...`), download from that address instead.

## 2. Start it with the token

Pass the whole link or just the token, in single quotes. Run it **in the background**
and keep it running for the whole session, because it holds the connection:

    node ~/.cache/wine-agent/wine-agent.mjs '<the link or wa1. token>' --runs-as='<what you are, e.g. "Codex CLI">' > ~/.cache/wine-agent/log.txt 2>&1 &
    sleep 2; cat ~/.cache/wine-agent/log.txt

The bridge writes one line per event. The first is:

    READY http://127.0.0.1:53817 key=4f0c…

Keep that address and key. Every request below goes to that address with the header
`Authorization: Bearer <key>`. The examples use:

    B=http://127.0.0.1:53817; K='Authorization: Bearer 4f0c…'

`--runs-as` is a label shown to the person ("says it runs as: …, unverified"). Make it
honest.

## 3. First run only: register

The first time on a machine, the bridge makes itself an identity (a signing key saved
in `~/.config/wine-agent/`) and has to register it as a bot, which takes one small
puzzle. The log then says `REGISTER …`:

    curl -s -H "$K" $B/register

That returns a `puzzle`. Solve it, then choose a bot name: 4 to 30 letters, digits or
`_`, ending in `bot` (the person will see it; for example `claudeplaysbot`):

    curl -s -H "$K" -X POST $B/register -d '{"answer":"<your answer>","username":"<name>bot"}'

Expect `{"ok":true,"username":"…"}`. If the answer is wrong you get a new puzzle, so
try again. Later runs on the same machine skip this step.

## 4. Wait for the person to click Allow

    curl -s -H "$K" $B/status

`state` walks through `starting`, then `publishing`, then `asking`, then `connected`.
`asking` means the answer was published; the bridge cannot yet tell whether the
page has displayed the request or the person clicked **Allow**. Tell them to click
Allow when the request appears, then poll `/status` every few seconds. If they
already allowed it and it remains `asking`, inspect the page's connection message
rather than repeatedly asking for approval. `next` in the reply says what to do.

- `connected`: go to step 5.
- `closed` or `failed`: read `error`. The usual causes are that the person denied
  you, closed the tab, or the link expired. Ask them for a new link and start again
  from step 2 (kill the old bridge first).

## 5. Look, then act

Start with a screenshot. Its pixels **are** the click coordinates:

    curl -s -H "$K" $B/screenshot.png -o screen.png      # then look at screen.png
    curl -s -H "$K" $B/snapshot                          # {screen:{w,h}, title, frozen}

Then act:

    curl -s -H "$K" -X POST $B/click -d '{"x":120,"y":88}'
    curl -s -H "$K" -X POST $B/click -d '{"x":120,"y":88,"button":"right"}'
    curl -s -H "$K" -X POST $B/dblclick -d '{"x":40,"y":40}'
    curl -s -H "$K" -X POST $B/drag -d '{"x1":10,"y1":10,"x2":200,"y2":150}'
    curl -s -H "$K" -X POST $B/key -d '{"key":"Enter"}'           # Escape, Left, F2, A, …
    curl -s -H "$K" -X POST $B/key -d '{"key":"Left","type":"down"}'   # hold …
    curl -s -H "$K" -X POST $B/key -d '{"key":"Left","type":"up"}'     # … release
    curl -s -H "$K" -X POST $B/type -d '{"text":"hello\n"}'

After each action, take another screenshot before deciding the next one. A game keeps
running while you think, so for anything timing-sensitive use frozen mode:

    curl -s -H "$K" -X POST $B/frozen -d '{"on":true}'    # the game stops
    curl -s -H "$K" -X POST $B/key -d '{"key":"Right","type":"down"}'
    curl -s -H "$K" -X POST $B/step -d '{"n":10}'         # run 10 steps, then stop again
    curl -s -H "$K" -X POST $B/key -d '{"key":"Right","type":"up"}'
    curl -s -H "$K" -X POST $B/frozen -d '{"on":false}'   # let it run again

If nothing is running yet, `GET /apps` lists what the person can run and
`POST /launch {"app":"sol"}` starts one.

Every reply is JSON: `{"ok":true,…}` or `{"error":"…"}`. The full list is in
[reference/api.md](reference/api.md). Tips for actually playing (timing, menus,
dialogs, common games) are in [reference/playing.md](reference/playing.md).

## The person stays in charge

The person can switch you to **watch only**, pause you, turn off your mouse and
keyboard, or disconnect at any time. Their page enforces this, not you. When it
happens, actions come back as errors saying why (for example `the player set
watch-only mode: you can look but not act`), and `/status` shows it under
`lastEvent`. Don't retry around it. Say what you'd like to do and let them hand
control back.

Run page code (`/eval`) only if they explicitly enabled it. It is off by default and
works only on debug pages.

## When you're done

    curl -s -H "$K" -X POST $B/disconnect

That tells their page you left and stops the bridge. Closing their tab ends it from
their side.

## Troubleshooting

| You see | Do |
|---|---|
| `ERROR … token` when starting | The token got cut off or mangled. Copy it again exactly, in single quotes. |
| `state: failed`, "network path … blocked" | A strict firewall or NAT on one side. Try another network, and tell the person. |
| `expired` / "link expired" | Ask the person for a fresh link from **Start → Connect Agent…**. |
| 401 from the bridge | The key is wrong. It's on the `READY` line, and a new one is made each run. |
| 409 `not connected` | Check `/status`. You may still be `asking`, or the session closed. |
| A click does nothing | Screenshot first, because the screen may have changed. Some controls need `/mouse` down, a short wait, then up. |
