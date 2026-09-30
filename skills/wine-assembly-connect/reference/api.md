# wine-agent local API

The bridge (`scripts/wine-agent.mjs`) serves this API on `127.0.0.1` only, on the port
printed in its `READY` line. Every request needs `Authorization: Bearer <key>` from that
line (or `?key=<key>` in the URL, for tools that can't set headers). Requests whose
`Host` is not `127.0.0.1:<port>` or `localhost:<port>` are refused with 403.

Request bodies are JSON. Replies are JSON unless noted:

- success: `{"ok": true}`, or `{"ok": true, "value": …}` when there is something to
  return
- failure: `{"error": "…"}` (or `{"ok": false, "error": "…"}` when the page refused)

| Status | Meaning |
|---|---|
| 400 | Your request is malformed: a missing number, an unknown key name, a body that isn't JSON. |
| 401 | The key is missing or wrong. |
| 404 | No such route. The reply lists them all. |
| 409 | Not connected yet, or no longer. Check `GET /status`. |
| 422 | The page refused: the player's permissions or mode, or the command failed page-side. `error` says which. |
| 502 | The page answered with something unusable. |
| 504 | The page didn't answer within 60 s (10 min for `/step`). |

## Session

| Route | Body | Returns |
|---|---|---|
| `GET /status` | | `{state, error, bot, origin, linkExpires, connectedSec, lastEvent, next}` |
| `GET /register` | | `{puzzle, expires_at, how}` while `state` is `needs-register` |
| `POST /register` | `{answer, username}` | `{ok, username}`, or a new puzzle on a wrong answer |
| `POST /disconnect` | | `{ok:true}`. It tells the page, then the bridge exits. |

`state` is one of `starting`, `needs-register`, `publishing`, `asking`, `connected`,
`closed` or `failed`. `next` is a sentence saying what to do in that state.

`lastEvent` is the newest thing the page told you, unprompted:

| `type` | When |
|---|---|
| `hello` | The channel just opened: `{app, perms, mode}`. |
| `perms` | The player changed what you may do: `{perms:{see, control, eval}}`. |
| `mode` | The player changed the mode: `{mode:"drive"\|"watch"\|"paused"}`. |
| `user-took-input` | The player grabbed the mouse or keyboard ("Take back"). |
| `bye` | The player disconnected. The bridge moves to `closed`. |

The bridge also logs every event to stdout as `EVENT {…}`.

## Seeing

| Route | Returns |
|---|---|
| `GET /screenshot.png` | `image/png` at the game's own resolution, whose pixels are the click coordinates. `?format=base64` returns `{png:"<base64>"}` instead. |
| `GET /snapshot` | `{value:{href, title, screen:{w,h}, frozen}}`. `screen` is `null` when no app is running. `frozen` says whether the game is stopped for stepping. |
| `GET /apps` | `{value:[ids…]}`: every app the page can launch. |

## Mouse

Coordinates are in screenshot pixels, with 0,0 at the top-left of the game's screen.

| Route | Body |
|---|---|
| `POST /click` | `{x, y, button?}`, where `button` is `"left"` (default) or `"right"` |
| `POST /dblclick` | `{x, y}` |
| `POST /mouse` | `{x, y, type}`, where `type` is `"down"`, `"up"` or `"move"`. Use it to hold a button, or when a control ignores a quick click. |
| `POST /drag` | `{x1, y1, x2, y2}`: press, move there in four steps, release |
| `POST /wheel` | `{x, y, delta}`: one wheel notch per request. Positive `delta` scrolls up, negative scrolls down, and only the sign counts. |

## Keyboard

| Route | Body |
|---|---|
| `POST /key` | `{key, type?}`. `key` is a name (`Enter`, `Escape`, `Space`, `Tab`, `Backspace`, `Delete`, `Left`/`Right`/`Up`/`Down`, `Home`, `End`, `PageUp`, `PageDown`, `Shift`, `Ctrl`, `Alt`, `F1`…`F12`), a single letter or digit, or a Windows VK number. Without `type` it presses and releases. `"down"` holds and `"up"` releases. |
| `POST /type` | `{text}`: types each character as a real key press. `\n` is Enter. Fine for names and chat boxes, less so for game controls, which need `/key` with timing. |

## Time

| Route | Body | Effect |
|---|---|---|
| `POST /frozen` | `{on:true\|false}` | Stops or resumes the game. While it's stopped, nothing moves between your actions. |
| `POST /step` | `{n, ms?}` | Runs exactly `n` steps of the game, repaints, and stops again. `ms` sets how much game time each step advances, and stays in effect for later steps. It replies once the game is at rest again, with `{ran, requested, …}`. Fails unless the game is frozen. |

## Apps

| Route | Body |
|---|---|
| `POST /launch` | `{app}`: an id from `GET /apps`, launched exactly as clicking its icon would |

## Advanced

| Route | Body |
|---|---|
| `POST /cmd` | `{raw}`: one raw input entry in the emulator's own syntax, such as `click:10:20` or `keydown:13` |
| `POST /eval` | `{code}`: JavaScript in the page. Only works when the player ticked "run page code" and the page was opened with `?debug`. |
