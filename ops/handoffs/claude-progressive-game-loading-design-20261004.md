# CLAUDE-PROGRESSIVE-GAME-LOADING-DESIGN — start a game without downloading all of it

Owner: claude-subagent of coordinator claude:1863d2b5 · 2026-10-04 · **design proposal only.**
No source, test, TODOS, git, deploy or runtime changes were made. Every claim below is
tagged with how it is known:

- `[SRC file:line]` means read at HEAD 16f764ad plus the working tree.
- `[INF]` means inferred from source and not executed.
- `[NEW]` means it does not exist yet.

No timing or byte-saving figure in this document is a measurement. The only numbers are
file sizes read off disk.

Companion documents. This design extends them and does not replace them:

- [claude-launch-ux-design-20261003.md](claude-launch-ux-design-20261003.md): the approved Win98
  "File Download" launch window and the 500 ms reveal rule (3R, 3D). It is implemented in
  `lib/launch-progress.js`, `host.js fetchAssetBytes/loadFiles` and the `lib/browser-shell.js` launch
  context.
- [claude-dashboard-ux-review-20261004.md](claude-dashboard-ux-review-20261004.md). The dashboard
  should show download state; §9 below lists only what the emulator page must export for that.
- [docs/design-byo-media.md](../../docs/design-byo-media.md) covers the lazy provider phases this
  builds on.

---

## 0. Summary

**Most of the hard part exists already.** The emulator can park a synchronous guest `ReadFile` on a
missing byte range, fetch the range asynchronously, and re-run the call. It does this on the main
thread, on spawned threads, and in both cooperative and Worker mode. Five registry entries already
use it in production for large archives (`httpRange`). What is missing is everything around it:

1. a manifest that knows sizes up front;
2. a per-page download scheduler with priorities, deduplication and a persistent cache;
3. a policy for which files must be present before start;
4. any player-visible UX for an in-game wait. Today an `httpRange` miss freezes the game silently;
   the player sees a hang.
5. an honest fallback for APIs that cannot park.

**Recommendation: option B** (§3). Extend the existing provider/park path, with a page-wide
`AssetScheduler` and a content-addressed OPFS cache. Use the launch window's shell for in-game waits,
reshaped as a window that belongs to the game. Pilot it on the **Heroes II demo**, with **StarCraft
shareware** as the second title and **Diablo shareware** as the explicit preload-fallback control.

---

## 1. What exists vs what is new

| Capability | Status | Evidence |
|---|---|---|
| Per-app file lists: `files[]` of string or `{url, vfsPath|vfsPaths, httpRange, optional, decodeImage, *Time}`, plus `requiredFiles`, `fileConcurrency`, `dlls`, `persistFiles` | exists | `lib/apps.js` (e.g. 1375-1388, 3504-3528, 3536-3557); consumed by `host.js:3264-3420` and `lib/browser-shell.js:3294-3315` |
| Out-of-repo file list `localFileManifest` (`{schemaVersion:1, files:[{url,vfsPath}], registry?}`) | exists, has no size or hash | `lib/browser-shell.js:3100-3135`; e.g. `test/binaries/candidates/moorhuhn/.wine-assembly-browser.json` |
| `httpRange` lazy archive: HEAD at launch → `HttpRangeProvider` → `ChunkCache` (256 KB chunks, 64-chunk LRU = 16 MB, read-ahead 1, in-flight dedup per chunk) | exists; **5 entries**: RCT (5 `Data/*.dat`), Heroes II demo `HEROES2.AGG`, StarCraft `stardated.mpq` + `install.exe` | `host.js:3309-3337`; `lib/byte-provider.js:188-416`; `lib/apps.js:324,1384,3545-3547` |
| Range server without `Accept-Ranges` → whole-file eager fallback | exists | `host.js:3333-3335` |
| VFS lazy entry: size known, `readFile` returns `pending` and never a short read; `fillPendingRead` has identity guards (handle reuse, entry replaced, provider changed); failure latched to `ERROR_READ_FAULT` after 3 unsatisfied fills | exists | `lib/filesystem.js:84-125, 640-705, 1453-1530` |
| Guest park: `$io_block` restores the stdcall frame, puts EIP back on the thunk, sets yield 12; the host fills and clears; the call re-runs | exists | `src/09a7d-handlers-shell-file.wat:303-319`; `host.js:5791-5805` (cooperative), `host.js:4704-4716` (Worker main) |
| Parking APIs: `ReadFile` (32-bit and Win16 bridge), overlapped/`ReadFileEx`, read-only `MapViewOfFile`, `mmioRead`/buffered mmio, AVI/MCI avivideo, D3D9 render wait | exists | `src/09a0-handlers-base.wat:3300-3318`; `09a7d:650-690, 2835-2847`; `09a7-handlers-dispatch.wat:5985-5999`; `09a3-handlers-audio.wat:1340-1356`; `09a7f-video-avi.wat:569-840` |
| Spawned-thread `io_wait`, per-thread pending slots, both schedulers | exists | `lib/thread-manager.js:127, 2076-2090, 2306-2315, 2871-2890`; `test/test-io-wait-threads.js` |
| Listing and metadata without bytes (`FindFirstFile`, `GetFileSize`, attributes use `_size`) | exists | `lib/filesystem.js:30-34, 893` |
| Runtime `LoadLibrary` of a lazy or unlisted DLL: yield 5, then `vfs.materialize` or fetch from served dirs | exists | `host.js:3518-3540, 3607-3625` |
| Sync consumers that **cannot** park: `_lread/_hread`, writable mapped views, resource/DLL loading from a sync import, audio/GDI file reads, `WriteFile`/`SetEndOfFile`/`CREATE_ALWAYS`/`CopyFile` on a lazy entry, `GetPrivateProfile*` | documented gap; currently throws `VfsPendingError` (a loud failure) | `lib/filesystem.js:102-121`; INI workaround `lib/media-import.js:85-102` |
| Nested synchronous callback waiting on a reader thread (Diablo: `WM_INITDIALOG` waits while Storm's worker reads the MPQ) | documented gap; fixed by keeping the file eager | `lib/apps.js:3515-3520`; `lib/media-import.js:719-723` |
| Launch window: one deadline, 500 ms reveal, byte progress only when every size is known, Retry keeps bytes, Cancel aborts | exists | ops handoff §0, §3R, §3D; `lib/launch-progress.js` (`REVEAL_DELAY_MS`, `createLaunchController`, `createDomView`) |
| Guest clock frozen across a pause (`wallStartMs += pausedMs`), with exceptions for audio-hot and networked guests | exists, **hidden-tab only** | `host.js:5476-5532`; `_guestTickMs` `host.js:1123-1160` |
| Writable C:\ overlay with OPFS/memory/node stores; `persistFiles` in localStorage | exists | `lib/overlay-store.js`, `lib/vfs-overlay.js:112-122, 230`, `lib/vfs-persistence.js` |
| Size and hash known **before** fetch; no HEAD per lazy file | **NEW** | `HttpRangeProvider` already has a sized constructor (`byte-provider.js:189`, used at `browser-shell.js:3229`) |
| Whole-file lazy (fetch on first open, small files, no Range needed) | **NEW** | |
| Page-wide scheduler: priorities, cross-instance dedup, bounded concurrency, background preload | **NEW** (today: one pool per `loadFiles` call with concurrency 6, plus a per-provider ChunkCache) | |
| Persistent HTTP-asset cache (OPFS, content-addressed, sparse) | **NEW** (only the HTTP cache today; the `sw-coi.js` worker does not cache) | |
| Any UX for an in-game park; audio and clock handling during a park | **NEW** (a long park looks like a hang) | |
| A failed demand fetch keeps the guest parked and offers Retry, instead of a read fault | **NEW** (today: latched `ERROR_READ_FAULT`, `filesystem.js:1505-1517`) | |
| CLI coverage of async parks for registry apps | partial: `test/test-vfs-lazy-entry.js` forces `{sync:false}`; `run.js --zip/--iso` use the sync `NodeFileProvider`, so it never parks | **NEW** flag proposed in §11 |

---

## 2. Requirements restated as testable rules

- **R1 Playable entry point.** The required set is the dependency closure needed to reach the title's
  first interactive screen, measured from an access trace, not guessed from file extensions. The
  closure includes files read under non-parkable APIs.
- **R2 Truthful metadata.** Presence, size, attributes and times of every manifest file are correct
  before any of its bytes arrive. A pending download never surfaces as `ERROR_FILE_NOT_FOUND`, a short
  read, or EOF.
- **R3 Demand first.** A guest-blocking request preempts background work and is never queued behind it.
- **R4 Best-effort background.** A failed hint never interrupts play. Background work is bounded,
  deduplicated, cancellable and cached.
- **R5 No late commits.** Bytes from a cancelled or superseded request never land in a VFS, an overlay,
  or a different instance.
- **R6 Clear failure.** A missing required asset fails before start with the existing `Download error`
  window. A missing lazy asset that the game actually needs gets an in-game Retry/Quit, not a silent
  read fault.
- **R7 Honest scope.** APIs that cannot park are listed; titles that hit them get preload.

---

## 3. Architecture options

| | A. Status quo plus a manifest | **B. Extend provider/park + page `AssetScheduler` + OPFS cache** | C. Service-worker virtual disk | D. Synchronous fetch in a Worker (Atomics + sync XHR) |
|---|---|---|---|---|
| Idea | Add `size` to `httpRange`, drop the HEAD, nothing else | Every lazy file is a provider entry backed by one shared scheduler; parks unchanged; UX for parks | A SW intercepts `/assets/*`, caches, and serves ranges | Guest thread blocks in a Worker on a sync read |
| Reuses | everything | `$io_block`, `fillPendingRead`, ChunkCache, launch window, overlay | little; the SW is new, and `sw-coi.js` already owns the scope for COOP/COEP | Worker backend |
| Main-thread guest (default cooperative) | ok | ok | ok (still parks) | **no**: the main thread cannot block, and most titles run cooperatively |
| Non-parkable APIs | unsolved | preload fallback, plus new parks where a handler can re-run | unsolved | partly (Worker only) |
| Dedup across two games | no | yes (page scheduler) | yes | no |
| Persistent cache | HTTP cache only | OPFS, content-addressed | Cache API | n/a |
| Risk | low | medium | high: SW lifecycle, COI interplay, Safari | high: sync XHR is deprecated, and it does not cover cooperative mode |
| Payoff | removes 5 HEADs | the goals in this brief | similar to B, at more risk | narrow |

**Recommend B.** A gives no UX and no policy, and the in-game freeze that already exists stays.
C duplicates B's cache behind a second lifecycle that collides with `sw-coi.js`. D cannot serve the
cooperative main thread, where nearly every game runs. B changes no WAT for the first stages (§10),
because the parks already exist.

### B in one picture

```
 guest API (WAT) ── miss ──► $io_block (yield 12, EIP on thunk)            [exists]
        ▲                         │
        │ re-run, cache hit       ▼
   VFS lazy entry ◄── fill ── AssetScheduler.demand(fileKey, range, ctx)    [NEW]
   (_provider =                    │  priority P0, dedup by (contentKey, chunk)
    ManifestProvider)              ▼
                         L1 ChunkCache (memory, per file)                  [exists]
                         L2 OpfsAssetStore (sparse, by sha256)             [NEW]
                         L3 network: Range GET / whole GET, If-Range        [extend]
   background hints ──► AssetScheduler.hint(...) P3, paused while any P0/P1 in flight
   launch required set ► AssetScheduler.require(...) P1 → existing launch window
   park episodes ─────► GameWaitController (500 ms reveal) → in-game wait window   [NEW]
```

`ManifestProvider` `[NEW]` is a provider (`{size, readRange, readRangeSync:null}`) whose size comes
from the manifest and whose `readRange` goes through the scheduler. For a `whole` file it fetches the
whole file once, through the same cache. This keeps `lib/filesystem.js` unchanged: it already
accepts any provider with `tryRead/fill` once wrapped by `cached()` (`filesystem.js:1453-1460`).

---

## 4. Manifest schema (backward compatible)

The existing shapes keep their meaning. A string, or `{url, vfsPath}` without `load`, stays
**required and eager**, so every one of today's ~230 entries loads exactly as before. `httpRange:
true` becomes shorthand for `load: 'lazy', fetch: 'range'`.

```js
// lib/apps.js — Heroes II demo, pilot (illustrative; sizes are the on-disk sizes, hashes TBD by tool)
heroes2_demo: {
  exe: heroes2DemoRoot + 'H2DEMOW.EXE',
  dlls: [heroes2DemoRoot + 'MSS32.DLL', heroes2DemoRoot + 'SMACKW32.DLL'],
  // NEW: generated by tools/gen-asset-manifest.js from the files on disk + an access trace.
  // Missing => today's behaviour (everything in `files` is required + eager).
  assetManifest: 'test/binaries/candidates/heroes-2-demo/files/.wine-assembly-assets.json',
  files: heroes2DemoFiles,          // unchanged; the manifest annotates, it does not replace
  requiredFiles: true,
  // NEW, optional: a title that must not run lazily (see §7) says so in one word.
  // lazyAssets: false,
},
```

```jsonc
// .wine-assembly-assets.json — schemaVersion 2 (v1 local manifests stay valid: no load field = required)
{
  "schemaVersion": 2,
  "title": "heroes2_demo",
  "version": "2026-10-04.1",                 // bumps when any byte changes; part of every cache key
  "chunkSize": 262144,                       // must equal the ChunkCache chunk for chunk hashes to apply
  "files": [
    { "url": "MSS32.DLL",            "vfsPath": "c:\\mss32.dll",            "size": 141312,
      "sha256": "…", "load": "required", "why": "static import of H2DEMOW.EXE" },
    { "url": "DATA/HEROES2.AGG",     "vfsPath": "c:\\data\\heroes2.agg",    "size": 43362148,
      "sha256": "…", "load": "lazy", "fetch": "range",
      "chunks": "DATA/HEROES2.AGG.chunks", // optional per-chunk sha256 list (binary), §6
      "hint": { "priority": "after-start", "ranges": [[0, 1048576]] },
      "why": "only ranges read; trace 20261004-h2-trace shows first-screen ranges" },
    { "url": "DATA/H2OFFER.SMK",     "vfsPath": "c:\\data\\h2offer.smk",    "size": 200052,
      "sha256": "…", "load": "lazy", "fetch": "whole", "hint": { "priority": "idle" } },
    { "url": "HELP/HEROES2.HLP",     "vfsPath": "c:\\help\\heroes2.hlp",    "size": 453694,
      "sha256": "…", "load": "lazy", "fetch": "whole" },
    { "url": "MAPS/BROKENA.MP2",     "vfsPath": "c:\\maps\\brokena.mp2",   "size": null,
      "load": "required", "why": "size unknown at manifest time => cannot be lazy (R2)" },
    { "url": "README.TXT", "vfsPath": "c:\\readme.txt", "size": 3992, "sha256": "…",
      "load": "lazy", "fetch": "whole", "optional": true }
  ]
}
```

Field rules:

- `load`:
  - `required`: present before the guest's first instruction. This is the default.
  - `lazy`: registered with its size at mount, bytes on demand.
  - `background` is not a separate value; it is `lazy` plus a `hint`.
- `fetch`:
  - `range`: needs `Accept-Ranges`. Checked once per origin, not per file; a 200 reply to a Range
    request makes the file fall back to `whole` eager.
  - `whole`: one GET on first demand, any server.
- `size` and `sha256` are **mandatory for `lazy`**. A `lazy` entry without a size is rejected by the
  generator and treated as `required` at runtime (R2: listings must not lie).
- `hint.priority`:
  - `after-start`: begins when the launch window closes.
  - `idle`: only when no demand has occurred for 2 s.
  - `never`: no prefetch.

  `hint.ranges` limits prefetch to the named ranges. Hints are advisory and never awaited.
- `optional` keeps today's meaning: absence at the source is the app's problem. That covers a 404 at
  generation time; a lazy optional file that 404s at demand time returns `ERROR_FILE_NOT_FOUND` from
  the re-run open, because it was never registered.
- `why` is free text for reviewers and the dashboard. It is never shown to players.
- `lazyAssets: false` on the registry entry, or the `?preload=1` URL / `--preload` CLI switch, turns
  every `lazy` into `required`. That is the safe fallback (§7).

Generator `[NEW]`: `tools/gen-asset-manifest.js --app=ID [--trace=LOG]`. It takes sizes and sha256
from disk, and per-chunk hashes for `range` files. With `--trace` it marks every file opened before
the first-interactive marker as `required`, and every file read through a non-parkable API (from the
trace's API name) as `required`. It refuses a manifest whose `version` is unchanged while a hash
changed. A build gate `[NEW]` (same family as `tools/check-apps-registry.js`) checks that every
manifest file exists, has that size, and matches its hash.

---

## 5. Dependency and scheduling rules

**Required closure (R1).**

```
required = exe ∪ static-DLL graph (already walked at launch)
         ∪ files opened before FIRST_INTERACTIVE in the trace
         ∪ files touched by any non-parkable API anywhere in the trace (§7)
         ∪ files read on a thread while main is inside a nested sync callback (Diablo class)
         ∪ every .ini/.lid (GetPrivateProfile*)  — same rule media-import.js:85-102 already applies
         ∪ files with unknown size
```

`FIRST_INTERACTIVE` is the first point where the title accepts input on its own first screen, in a
headless run. For the pilot it is the Heroes II main menu. Taking it from the existing dashboard
"reached menu" evidence is `[INF]`.

**Scheduler `AssetScheduler` `[NEW]`, one per page,** shared by every app instance on the desktop.

| Class | Source | Concurrency | Preemption |
|---|---|---|---|
| P0 demand | a guest is parked on this range now | up to 4 at once, always admitted | never preempted |
| P1 launch-required | launch window batch | the existing `fileConcurrency` (default 6), capped to total 6 | yields slots to P0 |
| P2 read-ahead | next N chunks of a file whose P0 just landed (today `readAhead: 1`) | 1 | dropped if P0 for another file arrives |
| P3 background hint | manifest `hint` | 1 (2 on fast links) | **paused** while any P0/P1 is pending; an in-flight P3 chunk (≤256 KB) completes, no new one starts |

- **Total open requests ≤ 6** per origin, matching the HTTP/1.1 per-host limit, so the page itself
  never starves P0 of a socket.
- **Dedup key** `(manifest.version, sha256, chunkIndex)` or `(…, 'whole')`. Subscribers are
  refcounted. A cancelled subscriber detaches; the fetch is aborted only when no subscriber remains.
- **P0 is never aborted** to make room for anything.
- **Bandwidth.** Browsers expose no rate limiter, so P3 is bounded by concurrency 1, chunk size, and
  a pause rule: if P0 latency on the last demand exceeded 300 ms, P3 sleeps 5 s. Use
  `fetch(..., {priority: 'low'})` where supported; it is a hint only.
- **Save-Data or 2G** (`navigator.connection` when present): P3 is off.
- **Background works only on lazy files of a running title.** It never prefetches another title,
  and it stops when the title exits.

**Ordering inside P0.** First come, first served across threads, because every parked thread is
equally blocked. A burst of misses on one file coalesces into one ranged request when the chunks
are adjacent (≤4 chunks).

---

## 6. Integrity, version, cache, memory, sparse files

- **Version pinning.** Every cache key includes `manifest.version` and `sha256`. Range requests send
  `If-Range: <ETag from the first response>`. A `200` instead of `206` means the server file changed
  mid-session. That is a hard stop for this title, shown as the failure window's
  "game files were updated" copy (§8). Mixing versions is never allowed.
- **Integrity.**
  - `whole` files are verified against `sha256` before commit.
  - `range` files are verified per chunk when `chunks` hashes exist. Without them, the length is
    checked (as today, `byte-provider.js:225-231, 352-357`) and the whole file is verified
    opportunistically once every chunk is present.
  - A mismatch discards the bytes and retries once from the network, bypassing L2.
- **Cache tiers.**
  - L1 is the existing ChunkCache, memory, per file, 16 MB LRU.
  - L2 `[NEW]` is `OpfsAssetStore`: `assets/<sha256>/data` (sparse file written at chunk offsets),
    `bitmap` (one bit per chunk), and `meta.json` (size, version, lastUsed, title).
  - L3 is the network. The HTTP cache sits underneath, uncontrolled.
- **Eviction.** L2 evicts by title LRU against `navigator.storage.estimate()`, keeping 20% headroom.
  `navigator.storage.persist()` is requested only after an explicit player action. Private browsing
  without OPFS falls back to L1 only; the behaviour is identical, just colder.
- **No late commits (R5).** Each request carries `{instanceId, launchToken, generation}`.
  - The L2 commit is content-addressed, so it is safe to complete after a cancel. The bytes are
    correct for anyone.
  - The VFS commit happens only through `fillPendingRead`'s existing identity check
    (`filesystem.js:1489-1500`), plus a new `instance.alive && instance.generation === req.generation`
    check.
  - Retry creates a new generation and reuses verified chunks from L1/L2 (the launch window's
    "Retry keeps bytes" rule, extended).
- **Writes.** The overlay is unchanged.
  - A write-open (`GENERIC_WRITE`, `CREATE_ALWAYS`, `TRUNCATE_EXISTING`), `CopyFile` source,
    `SetEndOfFile` or writable `MapViewOfFile` on a lazy entry needs whole bytes (`filesystem.js:107-110`).
  - Stage 2 makes `CreateFileA/W` and `MapViewOfFile` park and materialize first `[NEW]`; both can
    re-run, being `$io_block`-shaped handlers. Until then such files are `required`.
  - `persistFiles` paths are never lazy.
- **Memory.** Eager files cost JS heap (`vfs.files` Uint8Arrays). Lazy files cost L1 only, at most
  16 MB per file. A page-wide L1 budget `[NEW]` of 64 MB on phones and 256 MB on desktop evicts the
  coldest file's chunks first. Background prefetch writes to L2, **not** L1, so preload never grows the
  heap. On a page with no OPFS, P3 is disabled for files bigger than 8 MB.
- **Sparse files.** Lazy files present the full `size` and are unaffected. The bitmap is the only
  "what do I have" record. A file the game writes past its end is a write (see above).

---

## 7. Per-API suspension and resume (on the owning context)

The owning context is the guest thread that issued the call. The park is always the `$io_block`
contract: frame restored, EIP on the thunk, yield 12, re-run on resume. Nothing completes a call
partially.

| API / path | Lazy-safe today | Plan |
|---|---|---|
| `ReadFile` 32-bit, main and spawned threads, cooperative and Worker | **yes** `[SRC]` | P0 through the scheduler; a failure keeps the thread parked and opens the wait window (Retry/Quit) instead of the latched read fault, **for manifest-lazy files only**. User-imported media keep today's fault latch: a removed USB File cannot be retried. |
| Overlapped `ReadFile`/`ReadFileEx` | yes `[SRC 09a7d:650-690]` | same |
| Win16 `ReadFile` bridge | yes `[SRC 09a0:3300-3318; test-win16-lazy-file-read.js]` | same |
| `_lread`/`_hread` | **no** | required, until the handler gets the `$io_block` shape `[NEW]` |
| `MapViewOfFile` read-only | yes `[SRC 09a7-dispatch:5985-5999]` | same |
| `MapViewOfFile` writable, `FlushViewOfFile` | **no** | stage 2: park and materialize before the view is created |
| `mmioRead`/buffered mmio, AVI/MCI avivideo, ICM | yes `[SRC]` | same; the wait window shows "video" copy (§8) |
| `PlaySound`/`sndPlaySound` from a file, `LoadImage(LR_LOADFROMFILE)`, `AddFontResource`, other GDI/audio file loaders | **no** (`filesystem.js:109`) | required. Telemetry: a `VfsPendingError` from these becomes a reported "needs preload" finding, not a crash with no explanation. |
| `GetPrivateProfile*` | **no** | `.ini`/`.lid` always required (existing rule) |
| `LoadLibrary` (runtime) | yes, async yield 5 `[SRC host.js:3518-3625]` | P0; DLL bytes are verified before the PE loader sees them |
| Static DLL graph, EXE, resources | needed before start | always required (the existing launch batch) |
| `CreateFile` open-for-read, `GetFileSize(Ex)`, `GetFileAttributes(Ex)`, `FindFirst/NextFile`, `GetFileInformationByHandle`, `SetFilePointer` | yes: metadata only | needs `size` and times from the manifest (R2) |
| `CreateFile` for write / `CREATE_ALWAYS` / `TRUNCATE_EXISTING`, `CopyFile`, `MoveFile` of a lazy source, `SetEndOfFile`, `WriteFile` | **no** | stage 2 park-and-materialize; until then required |
| DirectSound/waveOut | no file I/O | n/a; bytes come from guest memory |
| CD audio (ISO media) | user media path | unchanged |
| A read on a spawned thread while main is in a nested synchronous callback that waits for it (Diablo) | **no** | required; the generator detects it from the trace (§5); runtime detection `[NEW]` logs `needs-preload` |

**Concurrent reads.**
- Each guest thread has its own pending slot (`thread-manager.js`, `getIoState`). Two threads parked
  on the same chunk share one P0 request (dedup); both resume on the same commit.
- A thread parked on file A does not block a sibling reading cached file B, cooperative or Worker.
- In Worker mode the host step must not wait on the parked thread's slice, which `lib/thread-manager.js`
  already arranges.
- The cooperative main thread parks the whole guest. That is the "game-only wait": the page's event
  loop, the desktop and other apps keep running, because the host `await`s instead of blocking
  (`host.js:5800`).

**Code.** The EXE and statically imported DLLs are never lazy. A runtime-loaded DLL is P0 through
yield 5. Lazy *code pages* (demand paging inside a PE image) are out of scope: the PE loader maps
whole images, and partial images would need WAT loader changes with no evidence of benefit.

---

## 8. Player UX

Two windows share the Win98 "File Download" shell:

- the **launch window**, which exists;
- the **in-game wait window** `[NEW]`, which is smaller and belongs to the game's own window.

Neither uses manifest words (`lazy`, `chunk`, `range`, `hint`, `manifest`, `P0`, `OPFS`). File
names are allowed, because the launch window already shows them. A human label comes from an
optional manifest `label` (`"map graphics"`), else the file name.

### 8.1 States and timing

| Situation | What the player sees |
|---|---|
| Fast cache hit at launch | nothing but the existing progress cursor; the launch window obeys 3D; **no change** |
| First start, required set downloading | the existing launch window. Totals now come from the manifest, so `NN% of Heroes II` is honest from the first byte (3R rule: every size known). Lazy files are **not** listed as pending; Details shows them under "Downloaded while you play". |
| Short in-game miss (<500 ms) | nothing. The game pauses briefly, as a CD seek would. The cursor does not change. |
| In-game wait ≥500 ms | in-game wait window (8.2) over the game's window only; game frame frozen and dimmed 30%; desktop, taskbar and other apps unaffected |
| Sustained wait, no bytes for 8 s | same window plus the slow note (wording reused from the launch window) |
| Failure after retries | the same window switches to the error body, with Retry / Quit game |
| Offline | error body with offline copy; auto-retries on the `online` event; Retry still works |
| Background preload | nothing in the game. The taskbar gets an optional small "↓" tray glyph (see 8.4); its tooltip and click give status. Never a dialog, never a sound. |
| Background failure | nothing. It is logged and shown on the dashboard; the next demand for that file retries normally. |
| Server files changed mid-game | error body with "updated" copy; only Quit game (and Start again on a direct link) |

**Episode and 500 ms rule.**
- An episode starts at the first park of a guest.
- Parks less than 250 ms apart belong to one episode, so a burst of chunk misses cannot flicker.
- The window is revealed at `episodeStart + 500 ms` only if the episode is still open. The timer
  callback carries the episode token and re-checks it, the same pattern as 3D.
- The window closes on the frame the guest resumes, if no new park follows within 250 ms.
- There is no minimum display time.
- A park that begins while the launch window is still up is part of the launch, and no second window
  appears.

**Game-only, not a hang.**
- The window is anchored to the game's window rectangle, not the screen. It has its own taskbar
  presence: the game's taskbar button gets an hourglass and reads `Heroes II — Loading`.
- The mouse cursor is an hourglass **only over the game's window**.
- The desktop, Start menu and other programs stay live and keep input.
- On a direct link (single-app page) it is centred and modal to the game, with the same 44 px buttons
  and Esc = "Quit game?" confirmation (Esc must not quit by accident).
- Win98 had no "(Not Responding)"-style title suffix for this, and we do not add one: that is the
  hang signal we must not imitate.

### 8.2 Wireframes and copy

Wait, total known (from manifest size of the parked range set):
```
+-[ico] Heroes II — Loading ----------------[_]+
|  (disc)→(page)→(game)                         |
|  Heroes II needs more game data to continue.  |
|  Loading: map graphics (HEROES2.AGG)          |
|  [##########..............]                   |
|  1.2 MB of 3.0 MB                             |
|  The game is paused and will continue by      |
|  itself.                                      |
|                        [Details >>] [Quit game]|
+-----------------------------------------------+
```
- The bar and the "x of y" figure are shown only when the total of this episode's pending ranges is
  known.
- Otherwise the sliding-block bar is shown, with `Loading: map graphics (HEROES2.AGG) — 640 KB so far`.
- "Time left" and "Transfer rate" follow the launch window's ≥2 s network-bytes rule.

Slow (no bytes for 8 s), added line:
```
|  Transfer rate: Waiting — no data for 12 sec  |
|  The network is slow. You can keep waiting or |
|  quit; nothing is lost by waiting.            |
```

Error (after automatic retries), default button Retry:
```
+-[x] Heroes II — Download problem ------------+
|  (red x) Heroes II couldn't load map graphics |
|  (HEROES2.AGG): the server didn't respond     |
|  (HTTP 503, tried 3 times).                   |
|  The game is paused. Retry to continue where  |
|  you left off.                                |
|                [Details >>] [Quit game] [Retry]|
+-----------------------------------------------+
```

Offline variant body:
`You're offline. Heroes II will continue when your connection is back.` The buttons stay the same.
It auto-retries on `online`.

Updated variant body:
`The game's files were updated while you were playing. Quit and start Heroes II again to continue.`
Buttons: `[Quit game]` and, on a direct link, `[Start again]`.

**Quit game** asks for confirmation:

```
Quit Heroes II? Anything you haven't saved will be lost.   [Keep waiting] [Quit]
```

The default button is **Keep waiting**. Quitting:

- stops the instance through the existing `stop()`/`failLaunch` teardown;
- aborts that instance's P0 subscriptions;
- keeps verified bytes in L2;
- returns to the desktop, or on a direct link to the existing "Show desktop / Start again" card,
  with the text `Heroes II was closed while loading game data.`

Details rows use the launch window columns: `Name, Size, Status` with
`Loading NN% | Waiting | Done | From cache | Failed`.

### 8.3 Input, focus, audio, timers, network

- **Input.**
  - While a wait window is visible, mouse buttons and key presses aimed at the game are **dropped**,
    not queued. A queued click would land as an unintended move after resume.
  - Keys and buttons held when the episode started get their release delivered at resume, so nothing
    sticks.
  - Focus stays with the game window and is not moved to the wait window on the desktop. On a
    direct link it moves to the default button, as the launch window does.
  - Short invisible parks (<500 ms) keep today's behaviour: input queues normally.
- **Clock.** At reveal, freeze the guest clock with the existing hidden-tab slide (`host.js:5516-5527`,
  `wallStartMs += pausedMs`), counting from the episode start. The game therefore does not see a jump,
  and `WM_TIMER` does not fire a backlog. It is not applied to short invisible parks; that is
  real-hardware-like disk latency. Open question Q2.
- **Audio.** At reveal, ramp the page's guest audio gain to 0 over 50 ms. Hold the audio scheduler so
  DirectSound/waveOut positions do not advance; reuse what the hidden-tab pause does, which is
  `[INF]` and must be confirmed in code. At resume, ramp up over 50 ms. A short park may click or
  repeat a buffer, which is no worse than today.
- **Network (virtual LAN / DirectPlay).** A networked guest must not freeze its peer
  (`host.js:5486-5499` already refuses to pause networked guests when the tab is hidden). Rule: **a
  title running a LAN session uses preload.** Any join or host from the lobby card forces `required`
  for all remaining lazy files before entering the session. The launch window shows them as a normal
  batch, with the copy `Getting the rest of Heroes II ready for multiplayer…`. A miss that happens
  anyway in a session (manifest wrong) shows the wait window with the extra line
  `Other players are waiting for you.` and does not slide the clock.

### 8.4 Background preload indicator (optional, stage 4)

There is a tray glyph in the taskbar's notification area while P3 is active. Its tooltip is
`Heroes II: saving game data for faster play — 12.4 MB of 43.4 MB`. Clicking it opens a small
property-sheet-style window with a list and two buttons: `Pause` / `Resume`, and `Keep for offline
play` (which requests `storage.persist()`). It never appears on a direct link unless the player
opens the program's own menu, so it adds nothing to the page shell. It is optional; stage 4 ships
without it if review prefers silence.

---

## 9. Dashboard surfacing (coordination, not duplication)

The emulator exports the state; the dashboard decides how to show it. In the dashboard review's
terms this covers P2-4 (a launch failure with a path back) and the progressive-loading line of its
§4.5.

- `window.WineDownloads.snapshot()` `[NEW]`, modelled on `WinePerf.snapshot()`. It returns:
  `{build:{rev,wasmSha}, title, manifestVersion, launchToken, state, episodes:[{start, revealedAt,
  closedAt, files:[{name, sha256, ranges, bytes, status, httpStatus, attempts}]}], background:{active,
  bytes, total, paused}, cache:{l2Bytes, hits, misses}, failures:[…]}`. It contains no guest memory.
- A launch opened from the dashboard (`&from=…`, per that review's P1-2) POSTs this snapshot on
  failure and on exit to an **ops-owned, local-only** endpoint. The endpoint, its storage
  (`scratch/runs/<id>/result.json`) and its display belong to ops-dashboard. No endpoint is proposed
  here.
- An actionable failure on the dashboard shows the exact build, file, sha256, HTTP status and
  attempts, and a "Launch again" link. That link is the same `index.html?app=ID` URL, so it enters the
  same launch and wait flow; there is no separate debug launcher.

---

## 10. State chart (one guest demand, end to end)

```
                          ┌──────────── cache hit (L1/L2) ─────────────┐
guest call ──► VFS tryRead ─ miss ─► PARKED(yield 12, episode open) ─┐  │
                                         │                            │  ▼
                                         │ scheduler.demand P0     RESUMED (re-run call → hit)
                                         ▼                            ▲
                                    FETCHING ── bytes ok, verified ───┤ commit if (alive ∧ generation ∧
                                     │   │                            │  fillPendingRead identity)
                 500 ms, episode open│   │ error (net/5xx/408/429)    │
                                     ▼   ▼                            │
                              SHOW WAIT  RETRY(250·n ms, n≤3) ──ok────┘
                              (clock frozen, audio muted, input dropped)
                                     │        │ exhausted
                                     │        ▼
                                     │   FAILED-PARKED (guest still parked; error body)
                                     │     │ Retry ─► new generation ─► FETCHING (reuses L1/L2 bytes)
                                     │     │ online event ─► FETCHING
                                     │     │ Quit ─► confirm ─► STOPPED (abort subs; keep L2; no VFS commit)
                                     │     └ 404/410 or If-Range 200 ─► FATAL (Quit / Start again only)
                                     └ no bytes 8 s ─► SLOW note (same state)
 Launch window cancel / instance stop at any state ─► CANCELLED: subscriptions detached, fetch aborted
                                                      only if refcount 0, late bytes go to L2 only.
```

Background (P3): `QUEUED → (no P0/P1 for idle window) → FETCHING → VERIFIED → L2`. Any P0/P1 moves it
to `PAUSED` (in-flight chunk completes). Failure → `BACKOFF(30 s, 2 min, 10 min)` → `GAVE_UP`, which
is silent; the dashboard sees it. Title exit → `CANCELLED`.

---

## 11. Staged rollout

Each stage is shippable, off by default until the next is validated, and controlled by the
manifest's presence or by `lazyAssets`. Existing apps change only when a manifest is added.

| Stage | Content | WAT changes |
|---|---|---|
| 0 | Evidence: a `--trace-fs` plus chunk-level read trace for the pilot (CLI), and `tools/gen-asset-manifest.js` producing a manifest from it. A new CLI flag `--lazy-latency=MS` wraps Node providers as async-only with a delay, so parks happen headlessly for registry apps (generalizing `test-vfs-lazy-entry.js`'s `{sync:false}`). | none |
| 1 | Manifest sizes: lazy files mount with a known size (no HEAD); the launch window gets honest totals; the build gate checks size and hash. Behaviour otherwise identical. | none |
| 2 | `AssetScheduler`, P0/P1, dedup, whole-file lazy, failure keeps the guest parked (manifest files only), in-game wait window with the 500 ms rule, clock/audio/input rules. Pilot only. | none (yield 12 already exists) |
| 3 | OPFS L2 cache, integrity per chunk, If-Range; background hints P3. | none |
| 4 | Park-and-materialize for `CreateFile`(write)/`CopyFile`/writable `MapViewOfFile`/`_lread`; second title (StarCraft shareware); optional tray indicator; dashboard snapshot POST. | yes, handler-shaped `$io_block` additions |
| 5 | Broader titles, one at a time, each with its own trace-derived manifest. Never a blanket "make everything lazy". | none |

Rollback for every stage: delete the manifest file, or set `lazyAssets: false`.

---

## 12. Validation matrix

The browser rows need the shared browser slot. The CLI rows need the runtime window. **None were
run for this proposal.**

| # | Scenario | Arm / method | Pass condition |
|---|---|---|---|
| V1 | Cold cache, pilot, unthrottled | browser, `?app=heroes2_demo`, cleared OPFS/HTTP | the launch window shows a determinate % from the first byte; requests = required set only (no AGG body bytes before first interaction except declared hint ranges after start) |
| V2 | Warm cache (L2) | reload | no launch window (3D); zero network bytes for L2-resident files; same frames as V1 at equal input script |
| V3 | Throttled (CDP 400 kbps, 400 ms RTT) | browser | the wait window appears only for episodes ≥500 ms, never flickers (≤1 show per coalesced burst), disappears on resume; the game frame after resume equals the unthrottled run's at the same guest input |
| V4 | Offline mid-game | CDP offline, then online | offline body; auto-resume on `online`; no read fault reaches the guest; the game continues |
| V5 | 503 ×3 then 200 | request interception | error body after 3 attempts; Retry resumes; previously fetched chunks are not refetched |
| V6 | 404 / file replaced (If-Range 200) | interception | FATAL body; only Quit/Start again; no mixed-version bytes committed |
| V7 | Quit during wait | browser | instance stopped; no later VFS commit (assert via snapshot generation); L2 keeps verified chunks; other running apps unaffected |
| V8 | Two games share a file (two instances of one title, or two titles sharing a DLL/sha256) | desktop mode | one network request per chunk (dedup); cancelling one does not abort the other's request |
| V9 | Concurrent readers | `test-io-wait-threads.js` extended plus a CLI `--lazy-latency` run of StarCraft (multi-threaded Storm reads) | both threads resume on one commit; no wrong-slot resume |
| V10 | Non-parkable API on a lazy file | unit: `PlaySound`/`GetPrivateProfileString` on a lazy entry | reported as `needs-preload` with the file name, not a bare crash; the generator would have marked it required |
| V11 | Diablo shareware with `lazyAssets` absent vs a forced lazy `spawn.mpq` | CLI `--lazy-latency` | control: eager passes the menu (as today); forced lazy reproduces the documented nested-callback failure, which proves the detector |
| V12 | Background preload | browser, pilot, idle on map | P3 bytes only while no P0 is pending; P0 latency with P3 on ≤ P0 latency with P3 off + one chunk time; P3 failure invisible in game |
| V13 | Memory | `tools/memory-series.js` probe, pilot 10 min | JS heap slope no worse than eager baseline; L1 ≤ budget |
| V14 | Actual gameplay | `test/test-diablo-shareware-browser-web.js`-style staged route for the pilot: title → menu → new game → map scroll → castle screen (reads new AGG ranges) | every stage reached with lazy on; screenshots reviewed (not just non-blank) |
| V15 | 500 ms boundaries for in-game episodes | `test/test-launch-progress.js`-style fake-clock unit for the episode controller | 499/500/501 ms, coalescing at 249/251 ms, stale token, close on resume, no minimum time |
| V16 | Phone | `tools/web-input-probe.js --viewport=375x667` and 667x375 | wait window fits, 44 px buttons, Esc confirm |
| V17 | Desktop isolation | Minesweeper running while the pilot waits | Minesweeper keeps input and repaints; the hourglass only over the pilot window |

---

## 13. Pilot

**Primary: Heroes II demo (`heroes2_demo`).**

Files from `lib/apps.js:1375-1388, 3613-3620`, with sizes read on disk:

| File | Size (bytes) |
|---|---|
| `H2DEMOW.EXE` | 1,199,616 |
| `MSS32.DLL` | 141,312 |
| `SMACKW32.DLL` | 66,560 |
| `DATA/HEROES2.AGG` | 43,362,148 (already `httpRange`) |
| `DATA/H2OFFER.SMK` | 200,052 |
| `HELP/HEROES2.HLP` | 453,694 |
| `DATA/CAMPAIGN.HS`, `DATA/STANDARD.HS` | 1,000 each |
| text files | a few KB |

Why this title:

- The big archive already runs lazily in the shipped build, so the park path is exercised by real
  gameplay today. The pilot adds sizes, the scheduler, the cache and **the missing wait UX**, without
  turning on laziness anywhere new.
- It is single-player and saves to `*.gm?`, which are `persistFiles` and never lazy.
- It has an active profiling owner on the board (the Heroes II worker), which is useful for
  coordinating routes.

Not claimed: the startup bytes saved beyond today's lazy AGG are small (a few hundred KB of
help/video). The pilot's value is correctness and UX on an existing in-game wait, not startup
speed.

**No access trace exists in the repo for any title.** I searched `scratch/runs`, `docs/re-notes` and
the scratch trees for `[fs]` / `--trace-fs` output and found none. Stage 0 must capture one before
any `required` set is asserted.

**Second: StarCraft shareware.** It has a lazy `stardated.mpq` and `install.exe`
(`lib/apps.js:3545-3547`), runs cooperatively. It adds multi-threaded
Storm reads (V9). Its asset directory is not present on this machine.

**Control: Diablo shareware.** Its `spawn.mpq` must stay eager (`lib/apps.js:3515-3520`). It is the
test that the fallback and the detector are honest (V11).

---

## 14. Risks

1. **The manifest is wrong.** A file read early under a non-parkable API is marked lazy, and the
   result is a crash where today there is none. Mitigation: trace-derived generation, the
   `needs-preload` runtime report, a per-title `lazyAssets:false` kill switch, and one title per stage.
2. **Waits that change game behaviour.** Clock sliding and dropped input are deliberate deviations.
   Some titles pace by audio position or by `QueryPerformanceCounter`, and those paths need checking
   (Q2).
3. **Multiplayer.** Parks freeze lockstep peers. The design forces preload before a session, but a
   wrong manifest can still stall a peer.
4. **OPFS quotas and Safari differences.** The design degrades to L1 only. That path is correct but
   colder, and it needs the Safari test that the launch window also lacks.
5. **Server drift.** If-Range requires stable ETags from the host (berrry.app and the local servers).
   This is unverified (Q3).
6. **The failure semantics change.** Today a read fault surfaces to the game; the design keeps the
   guest parked. A game that would have recovered from `ERROR_READ_FAULT` now waits for the player,
   which is the intended behaviour, but it is a behaviour change.

## 15. Open questions

- **Q1.** Should the in-game wait window be allowed on the desktop for titles minimized to the
  taskbar, or only flash the taskbar button? (Proposal: flash only.)
- **Q2.** Freeze the guest clock only for visible episodes (≥500 ms), as proposed, or for every park?
  This needs a measured A/B on a timer-paced title.
- **Q3.** Do the deploy host and the local servers send stable `ETag`/`Accept-Ranges` for every asset
  path? This is a deploy-side check, owned elsewhere.
- **Q4.** Where should hashes and manifests live for deployed titles: beside the files, or embedded in
  `lib/apps.js`? Embedding grows the page script; beside the files costs one more request per launch
  (a cached JSON).
- **Q5.** Is a background-preload indicator wanted at all (8.4), or should preload stay invisible?
- **Q6.** Who owns the ops endpoint for the snapshot POST (§9)? This design says ops-dashboard.

## 16. Evidence and provenance

Source read at HEAD 16f764ad with the working tree. File:line citations are in each table. Notes,
the evidence index and the board lines are under `scratch/claude-progressive-game-loading-20261004/`.
Nothing was built, run or deployed.
