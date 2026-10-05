# CLAUDE-LAUNCH-UX — launch/loading UX design and implementation

Owner: claude:1863d2b5-bc58-4c0b-9c15-00fc951f0256 · status: **implemented and coordinator-reviewed** (2026-10-04).
User approved revision 2 + the 500ms rule on 2026-10-03T23:52:33Z ("let's go with this UX looks good",
`scratch/claude-launch-ux/implementation/approval.json`). Coordinator corrections and final50-check/browser acceptance are recorded in
[launch-ux-coordinator-review-20261004.md](launch-ux-coordinator-review-20261004.md). Source checkpoint publication only; no public game deployment. The mockups below stay labelled proposals; implementation evidence is in section 0.

## 0. Implementation (2026-10-04)

**What a visitor now gets**
- `?app=ID` (without `?debug`): a head script marks `html.direct-launch` before first paint; CSS hides
  the desktop icons, taskbar, Start menu, Read Me, build stamp, debug chrome and `#compile-status`
  on a black page. `initDesktop()` and the rest of the desktop work (~90 icon PNGs, the 7
  "runtime" EXEs fetched for icons, `lib/app-icon-manifest.json`, the 10 Start-menu PNGs, the account
  probe, the kept-media catalog) run only in `ensureDesktop()`: at DOMContentLoaded on a normal visit,
  and on a direct link only when the program exits or the visitor picks Show desktop. The launch
  starts at DOMContentLoaded, not `load`.
- One launch window, the Win98 "File Download" shell of 3R, in every mode: `NN% of SOL.EXE` /
  `Downloading Solitaire` / `Preparing …` / `Starting …`; globe→page→folder art; a segmented bar filled
  by real bytes only when every file of the current batch has started and reported its size;
  `Not known (N copied)` otherwise; time left and transfer rate only after 2 s of non-cache bytes;
  `Waiting — no data for N sec` + "the network is slow" after 8 s; `From cache: N of M` only when
  Resource Timing proves it; Details lists each file (name, size or `?`, cache/done/NN%/failed).
- 500 ms rule (3D): one deadline from the launch request (navigation start for a direct link); no
  window, taskbar button, focus or announcement before it; fast launches never show it; stale timers
  re-check their own token; closes on the frame the first top-level window appears, no minimum.
- Download failure: the window becomes `Download error` with file + HTTP status + attempts and Retry
  (bytes already fetched are reused by Retry) / Close (direct link: Show desktop). Shown at once when
  it happens before 500 ms, never preceded by a loading window. Other launch failures still go to the
  crash report, unchanged.
- Cancel in every phase: aborts in-flight fetches, releases the instance, stops an app already
  registered but still windowless. A direct link then shows "Starting X was cancelled" with Show
  desktop / Start again; on the desktop the window just goes.
- Desktop: non-modal (`aria-modal=false`), never takes keyboard focus, draggable, minimizable to its
  own taskbar button (`#launch-task-buttons`), other apps keep running and keep keys; asking to launch
  again during a boot brings the window forward. Direct link/phone: modal, focus on the default
  button, Esc = Cancel, 44px touch buttons, landscape drops the art to fit, reduced motion stops
  the animation, polite live region announces phase changes and errors only.
- An `?app=` id that names nothing: "There is no program called “x”" with Show desktop.
- Frozen pages (`?frozen`) treat "registered" as ready so the window never sits over agent screenshots.

**Files changed** (diffs vs the pre-task snapshot in `scratch/claude-launch-ux/implementation/evidence/diffs/`)
- `lib/launch-progress.js` (new): pure controller (injectable clock/timers/view) + DOM view.
- `index.html`: head direct-link script; direct-launch + window CSS; `#launch-task-buttons`;
  Start-menu icons `src`→`data-src` (loaded by `ensureDesktop`); `lib/launch-progress.js` second in
  `WINE_RUNTIME_SCRIPTS`; `?app=` launcher at DOMContentLoaded adopting the head-script launch;
  `ensureDesktop`/`appLabelFor`/`appIconFor`/`restoreMediaLibrary`; shell deps.
- `host.js`: `fetchAssetBytes(url, {signal, onTransfer, retained, transferId})` (streamed byte
  progress, `Content-Length` trusted only without content coding, split assets = unknown size,
  Resource-Timing cache detection refused behind a service worker or cross-origin, download errors
  tagged `isDownloadError`); `loadFiles({transfer})` with one id per retried file, abort not retried
  or swallowed as optional, aggregate error carries file/attempts; `loadExe`/`loadDlls` use
  `this._launchTransfer`; `#compile-status` suppressed while a launch window owns the launch.
  The default (no options) path is the old one; the CLI only imports shell-path helpers from host.js.
- `lib/browser-shell.js`: launch context (window, AbortController, Retry bytes), phases/batches
  (exe, files excluding `httpRange`, DLL graph = open-ended batch), LAN cards hold the reveal,
  checkpoints after non-abortable awaits, quiet cancel, download errors → window not crash report,
  rAF + 100 ms first-window detection, launch-window-aware canvas focus, `settleLaunchWindow`.
- `lib/browser-input.js`: 3 lines — keys whose target is inside `[data-wine-page-dialog]` are not
  sent to the guest. (The same file also carries an inherited `onmouseleave` hunk that is not mine.)
- `test/test-launch-progress.js` (new, unit), `test/test-web-direct-launch.js` (new, e2e by naming
  convention); `tools/test-tiers.js` needed no change.
- `test/test-web-single-app-quit.js`: 1-line fix — remove the exclusive-verdict pin the test put on
  the shared renderer before launching Notepad (pre-existing failure, see below).
- `lib/resources-icon.js`: unchanged (`preExtractedIconUrl` already sufficed).

**Validation** (local loopback, sole browser slot, headless Chrome 151.0.7922.108, Node v24.18.1,
puppeteer 25.7.0, served wasm sha256 f40d4ca3…5b49063 unchanged; pins in `evidence/pins.txt`)
- `node test/test-launch-progress.js` → exit 0, 23 cases: 499/500/501 ms boundaries, ready exactly at
  the deadline before the timer runs, no reset on phase change, startedAt-relative deadline, cancel
  then timer, direct-link cancel card, failure before 500 ms, stale timer vs next launch, ready A /
  slow B, superseded launch, prompt hold, Retry adoption (slow and fast), unknown sizes, not all
  files started, rate only after 2 s, cache counted not timed, 8 s stall, monotonic percent,
  starting = status line, action routing.
- `node test/test-web-direct-launch.js` → exit 0, 42/42 checks, ~20 s (evidence run; also 40/40 ×2
  before the last two checks were added). Server-forced states: slow with size, no size + 9.5 s
  stall, 503, 404, slow for Cancel, cacheable headers. Covers: zero desktop-icon/taskbar frames
  before the program on a direct link; request set limited to runtime + sol.exe, cards.dll, sol.hlp,
  sol.png + msvcrt.dll from the DLL graph + the page's PWA icon + the local-only shared stdole2.tlb;
  no icon manifest / other icons / Start-menu art; window first visible ≥ 500 ms; real percentage
  with known size; closes within one sampled frame of the first app window; unknown size and stall
  wording, landscape fit, 44px buttons, dialog/modal/live region, focus on Cancel, Esc cancels;
  error never painted over, Retry refetches and starts; unknown id; Cancel stops requests and
  memory, cancel card, Show desktop builds the desktop; desktop non-modal, keys reach running
  Minesweeper, taskbar button, Details rows, Minimize/restore, reduced motion, cancel leaves the
  other app; warm relaunch (ready 162–392 ms across runs) never revealed; fast failure (79–146 ms)
  shows the error first, no crash report, Close keeps running apps; cache hits reported without a
  service worker, none claimed on a cold load or behind `sw-coi.js`. Receipt
  `evidence/browser-receipt.json`; screenshots `evidence/screens/*.png` (inspected).
- Gates: `tools/check-browser-cache-versions.js` OK (+ `--self-test`), `tools/check-test-manifest.sh`
  OK (test tiers + timeouts), `tools/gen-host-import-sigs.js --check` OK,
  `tools/region-census.js --js-copies` OK. No WAT changed; no canonical build run.
- Regressions (logs in `evidence/logs/`): pass — test-web-failed-launch-recovers,
  test-web-notepad-close-desktop, test-web-app-close-frees-memory, test-web-agent-frozen,
  test-single-app-keep-aspect, test-web-shutdown, test-funtris-web-launch, test-web-single-app-quit
  (after its 1-line fix), and Node: test-boot-cursor, test-shell-execute-launch, test-asset-parts,
  test-system-data-files, test-single-app-mode, test-cd-audio-mci, test-vfs-persistence,
  test-vfs-overlay, test-browser-worker-vlan-address and others; `node test/run.js --app=sol
  --max-batches=300` exit 0.

**Outstanding / limits (not claimed)**
- `test/test-web-page-fullscreen.js` fails at its final rotation section *also on the pre-task
  baseline* (`evidence/logs/BASELINE-test-web-page-fullscreen.log`): the scroll-collapse gutter is
  only armed by `enterPageFullscreen()`, which also shows the close chip, so "gutter visible and no
  chip" cannot hold with committed `lib/page-viewport.js`; plus a read-before-resize race. Not
  touched (another owner's area).
- `test/test-web-double-tap-single-launch.js` failed 1 of 3 runs on its own race (it checks any
  window in `renderer.windows` while the boot cursor waits for a *visible* top-level window, the
  same condition as before); passed on reruns.
- Unrelated pre-existing unit failures seen while sweeping: test-debug-dropdown-manifests (missing
  corpus file), test-debug-game-apps (`lib/apps.js` dropdown membership), test-blobby-touch-keys
  (gameplay pixel band). None read the launch path.
- Cache hits are invisible behind a service worker: the live site installs `sw-coi.js` after the
  first visit, so there "From cache" will usually be absent (reported as unknown, never as network).
- Totals are per download batch (exe, then data files, then DLLs, which never has a total because the
  graph is discovered as it is walked), so the bar can restart between batches; no size manifest.
- `#compile-status` stays for launches without a launch window (none in the shipped pages).
- The 86-script runtime is still loaded whole (lazy GL/D3D/VLAN loading remains a separate follow-up).
- Not exercised in a real phone browser or Safari; headless Chrome only. No public deployment.

- Revision 1 (step-checklist dialog): `scratch/claude-launch-ux/{ascii.txt,single-app.png,desktop.png}`,
  Telegram msgs 284–287 (`telegram-delivery.json`). Superseded by user correction
  "i think need to design more like windows file downloading dialog".
- **Revision 2 (current)**: `scratch/claude-launch-ux/revision-2/{ascii.txt,single-app.png,desktop.png}`
  (sources `*.html`, `mock2.css`, `art.js`, `render-mockups.cjs`), Telegram msgs 291–294 at
  2026-10-03T23:45:48Z (`revision-2/telegram-delivery.json`). See section 3R; it replaces the
  dialog *presentation* of section 3. Sections 1, 2, 4 and 5 (direct-launch gate, request scope,
  states, files, network assertions) are unchanged.

## 3R. Revision 2 — classic Win98 "File Download" window

One compact window, recognisably the IE4/Win98 download dialog:

```
+-[ico] 40% of Solitaire --------------[x]+
|  (globe) . . . [page] . . . [folder]    |
|  Saving:                                |
|  Solitaire (12 files) from <host>       |
|  [##########..............]             |
|  Estimated time left: 6 sec (3.1 MB of 7.8 MB copied)
|  Now saving:     CARDS.DLL              |
|  Transfer rate:  820 KB/Sec             |
|  From cache:     2 of 12 files          |
|               [Details >>]  [ Cancel ]  |
+-----------------------------------------+
```

- Title and taskbar button: `NN% of <App>` while the percentage is honest, `Downloading <App>`
  when the total is unknown, `Preparing <App>` / `Starting <App>` otherwise.
- Illustration: globe → page → folder while downloading; folder → page → computer-with-hourglass
  while preparing/starting. Static CSS/SVG art (our own drawing, not copied Microsoft bitmaps);
  the page drifts along the arc only without `prefers-reduced-motion`.
- Segmented navy bar (Win98 block style) filled by **bytes**, only when every pending file's size
  is known. Unknown total: a 4-block group slides across the bar, and the time line reads
  `Estimated time left: Not known (48.2 MB copied)` — the original dialog's own wording.
- `Estimated time left` and `Transfer rate` appear only after ≥2 s of network (not cache) bytes,
  from a smoothed rate; hidden otherwise. Stall ≥8 s: `Transfer rate: Waiting — no data for N sec`.
- `From cache: N of M files` row only when N > 0.
- Preparation/startup phases: same shell, no bar, a plain status line
  (`Preparing emulator…`, `Loading program…`, `Starting Solitaire… Waiting for the program's
  first window (0:07 elapsed)`) and a `Downloaded: 12 files, 7.8 MB (2 from cache)` summary.
- Error: same shell, title `Download error`, red ✕ icon, file + HTTP status + attempts, "13 of 14
  files are already saved and will be kept"; buttons `Details >>`, `Close` (direct: Show desktop),
  default `Retry`.
- `Details >>` / `<< Details` (collapsed by default) toggles a list view: Name, Size (or `?`),
  Status (`From cache`, `Done`, `NN%`, `Waiting`, `Failed`).
- Desktop: non-modal, draggable, minimizable; other apps keep running and keep input. Direct link:
  centred on a black page, `aria-modal="true"`. Phone: width `min(355px, 100vw - 20px)` portrait,
  ≤460px in landscape, 40px+ touch buttons.
- Accessibility as section 3: `role="progressbar"` with values only when determinate, polite live
  region for phase/error changes, Esc = Cancel, focus to Cancel/Retry.

Implementation impact vs revision 1: same files; `lib/launch-progress.js` view renders this shell
instead of the checklist, and the reducer additionally keeps a smoothed network-only rate
(unit-tested: no rate/time from cache-only bytes or <2 s of data; time left absent when any size unknown).

## 3D. 500 ms reveal delay (user correction 2026-10-03: "only displays if load takes more than 0.5 s")

Applies to every mode (direct link, desktop, phone single-app) and every phase. Supersedes any
"show immediately" wording elsewhere in this file.

- **One deadline per launch**, `revealAt = launchStart + 500 ms`. `launchStart` is the user's
  launch action: navigation start (`performance.timeOrigin`) for a direct link, the
  launching click/tap/`launchApp` call on the desktop. It is **not** reset at phase changes
  (preparing → downloading → loading → starting all count against the same 500 ms).
- **Until revealed, nothing of the dialog exists for the user**: not rendered, no taskbar
  button, no focus move, no `aria-live` announcement, no Esc binding. Only the existing
  `progress` cursor (and the black backdrop on a direct link) is present from the start.
- **Fast launch**: if the first usable app window paints before `revealAt`, the timer is
  cleared and the dialog is never shown — no flash.
- **Timer fire is a re-check, not a command**: the callback carries its launch token and shows
  the dialog only if `token === currentLaunch.token` and that launch is still pending (not
  ready, cancelled, failed or superseded). A stale timer from an earlier launch can never
  reopen a dialog. Timers are cleared on ready, cancel, failure and supersede.
- **Close promptly** on readiness, in the same frame the first window is composited; there is no
  minimum display time once shown.
- **Failures before 500 ms**: the actionable error window (same shell, `Download error`, Retry /
  Close) appears directly; no transient loading dialog is shown first. Failures after reveal
  switch the visible window to the error body in place.
- **Retry** starts a new launch token with a new 500 ms deadline (the error window is already up,
  so the user sees the error window turn into progress only if Retry is still pending at 500 ms;
  until then the error window shows "Retrying…" in its status line — it never disappears and
  reappears).
- **Launch-owned prompts** (LAN lobby, room/sign-in card) suppress the reveal while they are open;
  if the launch is still pending when the prompt closes and `revealAt` has passed, reveal at once.
- **Desktop concurrency**: a second launch request for the same app before reveal does not force
  a reveal; after reveal it focuses the existing window (section 3).
- Unknown-size progress, honest numbers and all other revision-2 constraints are unchanged.

Planned deterministic validation (not written yet; reducer/controller with an injected fake clock
and fake "first window" signal in `test/test-launch-progress.js`, plus two Puppeteer checks):

| Case | Expectation |
|---|---|
| ready at 499 ms | never shown; timer cleared; no taskbar button, no live-region text ever |
| ready at exactly 500 ms, before timer callback runs | not shown (re-check sees ready) |
| ready at 501 ms after reveal | shown once, removed on the ready frame; no minimum time |
| still pending at 500 ms, phase changes at 200/400/700 ms | shown once at 500 ms; no reset |
| cancel at 300 ms, timer fires at 500 ms | never shown; no further requests |
| fail at 300 ms | error window shown directly; loading body never rendered |
| launch A at 0, cancel, launch B at 200 ms; A's timer fires at 500 ms | nothing shown at 500 ms; B shown at 700 ms if still pending |
| launch A ready at 100 ms, launch B at 450 ms (desktop) | B revealed at 950 ms only if pending; A's cleared timer has no effect |
| prompt open 0–2 s, launch pending after | revealed when prompt closes, not under the prompt |
| Puppeteer warm-cache `?app=sol` | rAF sampling never sees the dialog |
| Puppeteer throttled `?app=diablo_shareware` | dialog absent before 500 ms, present by 500 ms + 1 frame, gone on first window |

## 1. What happens today (read-only investigation)

Direct link `index.html?app=ID`:

1. `index.html` document-writes **all 86 runtime scripts** (`WINE_RUNTIME_SCRIPTS`,
   index.html ~1815) synchronously, GL/D3D/Glide/VLAN/media-import/recorder included.
2. In non-debug mode `initDesktop()` runs at `DOMContentLoaded` (index.html ~2650,
   ~2853) **even for `?app=`**: it builds every desktop icon, and each one calls
   `loadAppIcon` (`lib/resources-icon.js:482`) → `lib/app-icon-manifest.json`, ~90
   `icons/apps/*.png`, and for the 7 `runtime`-bucket apps **the whole executable**
   (`fetchIconDataURL`), plus `icons/ui/{sources,readme}.png`.
3. The `?app=` launcher (index.html ~2315) waits for `window` **`load`** — i.e. until
   those icon images have finished — then calls `shell.launchApp(wanted)`.
4. Meanwhile the teal desktop, icons and taskbar are painted: the visible flash.
5. `launchAppInner` (`lib/browser-shell.js` ~2297) → `WineAssembly.init` (`host.js:2102`:
   1.6 MB wasm, `src/api_table.json`, five `.fon`, substitute fonts) → `loadExe` →
   `loadFiles` (`host.js:3097`, concurrency 6, 3 retries for 5xx/408/429) → DLL walk → run.
6. Feedback: `body.app-booting { cursor: progress }` (index.html:774) until
   `releaseBootCursorOnFirstWindow` sees a top-level window; progress text goes to
   `#status` / `#log`, which are hidden outside `?debug`. `#compile-status` exists only
   for the wasm compile. No cancel, no error UI beyond the crash report, no retry.

Facts that shape the design: no Cache API / service worker (HTTP cache only); sizes
are not known before fetch (no size manifest; split `.partNNN` assets have no total);
5 apps use `httpRange` lazy archives (bytes arrive during gameplay, not at launch);
only one boot may be in flight (`launchInFlight`), other apps keep running.

## 2. Goals

- Direct URL: **no desktop paint and no desktop work** (icons, manifest, readme, start
  menu account probe) until the user leaves the app.
- Network: selected app's manifest (exe, DLLs, `files`, one icon) + shared runtime only.
- One loading dialog, Win98-styled like `#readme-window`, used by direct launch,
  desktop launch and phone single-app launch. Non-modal on the desktop.
- Honest progress: never a fabricated percentage.

## 3. The dialog

```
+-[icon] Starting Solitaire ------------------[_][x]+
|  [32px icon]  Solitaire                           |
|  [v] Emulator ready              (from cache)     |
|  [>] Downloading program files   4 of 12 files    |
|      [#########............]  3.1 MB of 7.8 MB    |
|  [ ] Loading program                              |
|  [ ] Starting                                     |
|  Elapsed 0:04                                     |
|                          [ Details ] [ Cancel ]   |
+---------------------------------------------------+
```

Phases (each a checklist row; only the current one has a bar):

| Phase | Source of truth | Bar |
|---|---|---|
| Preparing emulator | `getWasmModule`, api_table, base fonts | bytes if wasm `Content-Length`, else marquee; "from cache" when warm (`_wasmModulePromise`) or `transferSize===0` |
| Downloading program files | `loadExe` + `loadFiles` progress | determinate **bytes** only when every file's size is known; otherwise "N of M files · X MB received" with a marquee bar |
| Loading program | PE load, DLL graph, env/args | marquee |
| Starting | until first top-level window (existing `releaseBootCursorOnFirstWindow`) | marquee + elapsed |

Honesty rules: the bar never moves backwards and never estimates; unknown size =
marquee + received bytes; split assets count as unknown; `httpRange` files are listed as
"streams during play" and are not waited on; cache hits show "N from cache" (detected
by `PerformanceResourceTiming.transferSize === 0 && decodedBodySize > 0`).

States:
- **Slow**: no new bytes for 8 s → row text "Waiting for DIABDAT.MPQ…" + "Network is slow"
  note; never auto-fails while bytes still trickle.
- **Error**: a required file fails after the existing retries → dialog switches to an error
  body (icon + file name + HTTP status/"network error"), buttons **Retry** / **Close**
  (direct mode: **Show desktop**). Retry refetches only failed files (successful VFS mounts
  are kept, as `loadFiles` already does). Optional-file failures become a non-blocking
  "2 optional files missing" line.
- **Cancel**: allowed in every phase. Aborts in-flight fetches (`AbortController` threaded
  into `fetchAssetBytes`), releases the instance via the existing `failLaunch` path
  (`stop({releaseNow:true})`), calls `bootDone()`. Esc = Cancel. Direct mode then shows a
  small "Launch cancelled — [Start again] [Show desktop]" card, not the desktop.
- **Starting takes long**: after 20 s in "Starting", add "Still starting — some programs show
  nothing until their first window." No timeout failure (the 10-min cursor guard stays).
- **Done**: dialog closes the frame the first window is painted (no fade over the app).

Placement and layout:
- Direct/phone: centered over a plain black backdrop (no teal, no icons, no taskbar);
  width `min(360px, 100vw - 24px)`. Landscape with height < 420px: compact form —
  icon left, checklist collapsed to the current phase line + bar, buttons to the right.
- Desktop: an ordinary non-modal Win98 window centred on the desktop, draggable by the
  title bar, its own taskbar button "Starting Solitaire…" with hourglass; it does not
  capture input outside its rectangle, so running apps keep keyboard/mouse and keep
  running. Minimize hides it to the taskbar. A second launch while one is in flight
  focuses the existing dialog (today it is silently ignored).

Accessibility: `role="dialog"` `aria-modal="false"` (desktop) / `"true"` (direct),
`aria-labelledby` title; bar is `role="progressbar"` with `aria-valuenow/min/max` only when
determinate (omitted when indeterminate, `aria-valuetext` gives "4 of 12 files"); one
`aria-live="polite"` line announcing phase changes and errors only (not every byte);
focus goes to Cancel on open and back to the launching icon on close; all buttons
reachable by Tab, 44px touch targets on coarse pointers; `prefers-reduced-motion`
replaces the marquee with a static striped bar; text ≥12px, contrast as Win98 dialog.

## 4. Direct-launch flow (target)

1. Inline `<head>` script (before any paint): if `?app=` names a registered id (or any id —
   validation happens later), set `html.direct-launch`. CSS hides `#desktop-icons`,
   `#taskbar`, `#readme-window`, `#build-stamp`, start menu; backdrop black.
2. The dialog shell is static markup (title from `?app` id, filled with the app label once
   `apps.js` has parsed) but stays **hidden** and is revealed only by the 500 ms rule of section 3D,
   counted from navigation start (`performance.timeOrigin`) — so a slow script download still gets
   a dialog at 500 ms, and a fast launch never shows one. The black backdrop is not a dialog and is
   present from first paint.
3. `initDesktop()` is **skipped** under `direct-launch`; launch on `DOMContentLoaded`, not `load`.
   Load only `icons/apps/<id>.png` for the dialog (no manifest, no exe fallback — glyph if 404).
4. On app exit / Show desktop: remove `direct-launch`, then run `initDesktop()` lazily (the
   existing `clearAppUrl` already pushes the desktop address; `popstate` relaunch kept).
5. Unknown id: dialog error "No program called “xyz”" + Show desktop.

Follow-up (separate, needs measurement before committing): load the GL/D3D/Glide/VLAN/
media-import/recorder scripts on demand by app capability (`tools/gfx-app-census.js`
already knows which apps reach them). Not part of the first implementation.

## 5. Implementation outline (after approval)

| File | Change |
|---|---|
| `index.html` | head flag script; CSS for `html.direct-launch` + dialog; static dialog markup; gate `initDesktop`; `?app=` on DOMContentLoaded; skip readme/account probe in direct mode |
| `lib/launch-progress.js` (new) | pure state reducer (phases, files, bytes, cache, slow timer, error, cancel) + DOM view; reducer is Node-testable |
| `lib/browser-shell.js` | `launchAppInner` emits phase events; Cancel/Retry/AbortSignal; replaces `#status`-only progress; focus-existing on concurrent launch; taskbar button |
| `host.js` | `fetchAssetBytes(url, {signal, onBytes})` streaming reader with `Content-Length`; `loadFiles` reports bytes/cache/failed-required; `init` reports wasm phase |
| `lib/resources-icon.js` | `loadSingleAppIcon(id)` (PNG only) |
| `test/test-launch-progress.js` (new) | reducer: unknown size never determinate, monotonic bar, slow after 8 s, retry keeps done files, cancel idempotent; 500 ms reveal cases of section 3D with an injected fake clock |
| `test/test-web-direct-launch.js` (new) | Puppeteer assertions below; add both to the test-tier manifest |

Network / visual assertions for `test-web-direct-launch.js` (local server, `?app=sol`,
plus one multi-file app such as `diablo_shareware`):
- Requests ⊆ {runtime scripts, wasm, `src/api_table.json`, `lib/host-import-sigs.generated.json`,
  `fonts/**`, `build-info.js`, `icons/apps/<id>.png`, the app's exe/DLLs/`files`}.
- Zero requests to `lib/app-icon-manifest.json`, other `icons/apps/*.png`, `icons/ui/*.png`,
  or any other app's `test/binaries/**` path.
- From `evaluateOnNewDocument`, sample each rAF: `#desktop-icons` and `#taskbar` never have a
  non-zero visible box before the first app window. Dialog is **not** visible before 500 ms after
  launch initiation, is visible by ~500 ms + one frame when the launch is still pending (throttled
  network), and is never visible on a launch whose first window paints before 500 ms (warm cache).
- Dialog removed within one frame of the first window; no minimum display time.
- 500 ms reveal boundary/race cases: see section 3D validation plan.
- Throttled (CDP `Network.emulateNetworkConditions`): slow note appears, bar is
  indeterminate when `Content-Length` is stripped by request interception.
- Intercept one required file → 503 ×3: error state, Retry succeeds and refetches only that URL.
- Cancel mid-download: no further app requests, instance released, no desktop paint.
- Reload: cache-hit counter > 0.
- Desktop mode: launch app A, then B with throttling; A's present/block counter keeps
  advancing and A receives a key press while B's dialog is open; cancelling B leaves A running.
- Phone viewports 375×667 and 667×375 via `tools/web-input-probe.js`: dialog fits, buttons ≥ 44px.

Out of scope: ScummVM/audio runtime work, deployment, lazy script loading (follow-up).

## 6. Approval

Approved by the user on 2026-10-03T23:52:33Z (revision 2 + 500 ms rule), relayed by Codex;
receipt `scratch/claude-launch-ux/implementation/approval.json`. Implemented per section 0.
Deployment was not part of the approval.

## Coordinator visual review of revision 2

Both labelled mockups were visually reviewed. The classic Windows download-dialog direction matches the requested revision. Before implementation, resolve one illustrative detail: the desktop mockup shows an unknown-size file beside a determinate total/percentage. The existing rule takes precedence: show a percentage only once every required file size is known. This is a mockup consistency note, not implementation approval.

Owner response (2026-10-03): agreed and recorded as a rule — **every known-size example (a
`NN%` title, a filled bar, `x of y MB`, or a time estimate) requires a known total, i.e. every
required file's size known.** Any file still showing `?` forces the indeterminate form
(`Downloading <App>`, sliding blocks, `Not known (N MB copied)`). The desktop.html source was
corrected before sending (`diabloui.dll` 412 KB); the review may have read the pre-fix render.
Either way the implementation follows the rule, not a mockup. No rerender/resend made for this note.
