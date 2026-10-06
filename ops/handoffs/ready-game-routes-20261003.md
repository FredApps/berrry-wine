# Available game routes — 2026-10-03

Read-only preparation; no guest/build/browser execution. Machine-readable
inputs, full static menu/dialog dumps, source hashes and exact asset SHA-256s:
`scratch/ready-game-routes-20261003.json`.

All 11 requested apps have their declared executable/assets present. The Win16
card apps additionally have `test/binaries/win98-16bit/CARDS.DLL`, which the
browser stages from beside the EXE (Hearts loads it dynamically). The JSON lists
every inspected path; `missingPaths` is empty for each app. This is an asset
check, not evidence that every future optional DLL/help path is available.

## Execution contract

Use ordinary browser mouse/keyboard actions only. Menu/control IDs below identify
the actual resource text and help locate live controls; they are **not** permission
to inject WM_COMMAND, dialog helpers, or mutate the guest. Inspect current native
canvas and window/control geometry before converting coordinates to browser CSS.
Historical 640×480 CLI coordinates are explicitly not a 1024×768 browser route.
Wait for the specified visible state after each bounded action, capture before
and after, and stop on errors or unexpected dialogs instead of repeatedly trying
F2. Existing tests target several different PE/NE builds; their distinctions are
recorded below. Do not invoke those test files as the batch runner: several build
or use internal posted commands.

Suggested order: `winmine16`, `freecell16`, `sol16`, `pegged`, `tictac`,
`mshearts16`, `snake`, then `cruel`/`golf` with explicit move-route review.
Actual key/menu availability is independently decoded from the installed
executables using `tools/parse-rsrc.js` and `tools/ne-dump.js`.

| App | Ordinary route | Required observable / limit |
|---|---|---|
| `winmine16` | Game → Beginner (521); click one covered grid-cell center. New is F2/510 if needed. | Reveal number/blank region; optional flag changes the cell/counter. A mine hit is a loss, not a valid continuous-play interval. Current NE menu confirmed. |
| `freecell16` | F3 opens Select Game (103); type `1` into visible edit, click OK. Once dealt, click bottom exposed card of column 1, then first empty free cell. | Game #1/dealt tableau; source column changes and free cell contains the card. Actual NE menu and Win16 deal test confirm setup; move gesture is from the PE analogue, so review actual before/after. |
| `sol16` | **Auto-deals at startup**: capture untouched tableau. Drag a face-up card toward an inspected legal target, or click visible stock to advance waste. Game → Deal is 1000; no F2 listed in this NE menu. | Seven columns already drawn; completed legal transfer or stock/waste change. Historical test drag `65,200 → 120,205 → 180,210 → 238,212` is a CLI geometry reference, not a browser contract or guarantee the random deal permits that destination. |
| `pegged` | Inspect peg grid; choose occupied source, occupied neighbor, empty landing two cells away. Mouse down source, move to landing, release. | Source and jumped peg disappear, landing fills; peg count decreases one. A click alone is insufficient. Actual PE board/menu exists; Win16 analogue tested `317,236 → 367,236`, so derive current centers freshly. |
| `tictac` | Optionally ordinary Game → `3 x 3` (103), Options → `Red always starts` (112); New F2/101 if needed. Click an empty square center. | Player mark lands in selected cell; computer responds if enabled. Actual PE menu/templates confirm choices. Win16 analogue's `249,319` lowest-plane point is not valid blindly for this PE. |
| `mshearts16` | Welcome: type name into live edit201, click `I want to be dealer` radio203, click OK1. Wait for dialog to close/status to request F2, then press/release F2. Select three hand cards, click Pass Left, then acknowledge received cards; play a legal card when it is your turn. | 13-card hand/AI backs, card selection and passing transition, then trick progression. A `Locate dealer` dialog means the wrong radio was selected. Resource templates and `test-win16-hearts-startup.js` confirm this sequence. Do not use stale fixed dialog coordinates. |
| `snake` | F2 once to start, then one safe Left/Up tap with release after inspecting direction and field. | Snake moves and changes direction; retain score/lives. `lib/apps.js` explicitly records measured F2/arrows behavior. Death/restart ends a continuous measurement interval. |
| `cruel` | Wait for maximized dealt board; actual PE F2/New command1 produces a new deal. | Capture complete tableau and deal transition. Existing current-PE regression proves layout, not a card move. **A successful legal move still needs live visual route review**; do not promote a redeal to completed card-play evidence or invent coordinates. |
| `golf` | Wait for dealt solitaire board; actual PE F2/New command1. Inspect stock/waste, click stock once, then optionally select an exposed card adjacent in rank to waste. | Actual stock-to-waste/card transition must be reviewed. Current-PE sweep establishes New only; stock action is a proposed ordinary route, not previously proven current-PE coverage. Golf here is the card game, not SimGolf/Fuji Golf. |

Hearts' older browser helper references card points `(220,400)`, `(290,400)`,
`(360,400)`, Pass `(290,318)`, and opening leftmost card `(170,400)` for its
640×480 geometry. Use only after geometry agrees; the current dialog's own
control rectangles take precedence. `test/test-win16-hearts-startup.js` explicitly
documents a historical wrong radio click hitting the group box.

## FPS semantics

Cruel, FreeCell, Golf, Hearts, Pegged, Solitaire, TicTactics and Minesweeper are
turn-based here. A board screenshot and successful input are useful gameplay
coverage, but idle GDI surface flushes are not gameplay FPS. Report action/paint
response separately; keep FPS unknown until a well-defined logical animation
boundary and active scene have independent counter proof. Rattler is continuous,
but likewise needs a logical frame counter and a living, moving scene rather
than raw paint/timer callback counts.

`dxball` and `blobby_volley` already have fresh reviewed gameplay screenshots in
`scratch/runs/20261003-dxball-gameplay-coordinator` and
`scratch/runs/20261003-blobby-volley-gameplay-coordinator`. No additional launch
was planned here. Their remaining blockers are:

- DX-Ball: raw DirectDraw notifications duplicate logical presentations; sample
  crosses a fade/life loss. Neither 507 total nor 219 slot-qualified callbacks
  over ~3s is accepted FPS. Need counter qualification and active-only interval.
- Blobby: canonical GDI flush rates are presentation proxies, not independently
  proved logical/displayed frames. Exclude serve-wait intervals and qualify the
  counter. Current run uses W jump / D move; old arrow-remap notes and persisted
  settings cannot override the exact current settings file.

The coverage worker owns logical-counter proof. This route plan grants no
concurrent browser slot and does not modify any existing run result.
