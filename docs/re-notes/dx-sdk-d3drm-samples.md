# DX SDK Direct3D Retained Mode samples (globe, viewer, flip3dtl)

`--app=dx_globe`, `--app=dx_viewer`, `--app=dx_flip3dtl`. The binaries are the
DirectX 5 SDK samples in `binaries/dx-sdk/bin/`, and their assets (`sphere3.x`,
`mslogo.x`, the `.ppm` textures) sit beside the exe and are mounted by the
registry entry — `node tools/gfx-app-census.js --apps=dx_globe --list` names
the families each one reaches.

They matter out of proportion to their size: they are the smallest programs in
the corpus that drive the D3DRM path end to end, so they fail faster and more
legibly than the games that share it. `tools/gfx-app-census.js` counts 10 apps
reaching d3drm and 9 reaching d3dim, including the seven `scr_*` screensavers,
which all name an identical family set and move together.

## "Failed to load sphere3.x" was never about the file (fixed 2026-09-22)

The symptom was a message box reading `Failed to load sphere3.x.
D3DRMERR_BADFILE`, which names an asset and a file-format error and is about
neither. Everything that looks guilty is innocent, in this order:

- The file is mounted. `--trace-fs` shows
  `CreateFile("sphere3.x", ...) → 0x70000001`: the open succeeds.
- The `.x` parser never runs. The failure is upstream of it, in
  `DirectXFileCreate`.
- `--trace-api` puts it exactly: `HeapAlloc(hHeap=0, dwFlags=8, dwBytes=8)`
  returns `0x00000000`. A **null heap handle**, which real Windows also fails.

The null handle is the tell. d3dxof keeps its heap in a global that its own
`DllMain` fills in, and that `DllMain` never got that far:

```
[LoadLibrary] d3dxof.dll loaded at 0x816000, dllMain=0x821040
WARNING: DllMain did not return cleanly, EIP=0x81ac0e yield=0 halt=3
```

`0x81ac0e` is the return address of the `SetEvent` in d3dxof's one-time init,
so the initializer was abandoned mid-frame — after it had taken its critical
section, before it had stored its heap. d3drm.dll aborted the same way at
`0x519720`.

**The cause was in the host, not the guest.** `lib/dll-loader.js`'s
`callDllMain` ran the initializer and, on any halt that was not a cooperative
`Sleep`, restored the caller's EIP and ESP and returned — which is precisely
what the comment above that loop says must never happen. Halt 1 (block budget
spent) and halt 3 (the host asked for control) are scheduling signals, not
completion. Fixed by resuming the initializer for both, bounded at 64 resumes.

After the fix all three DllMains report `DllMain returned, EAX=0x1`, the
message box is gone, and dx_globe runs 346804 API calls in 20000 batches
against 911 before, drawing a lit, textured sphere.

**The general lesson, which is why this is written down:** a half-initialized
DLL fails arbitrarily far from `DllMain` and never mentions it. The error it
produces is whatever the first unwritten global happens to break — here, a
file-format error for a file that had already opened. `halt=` in that warning
is the fact that separates "wanted one more slice" from "genuinely stuck", and
it is printed for that reason.

## Where they stand now

Measured 2026-09-22 at 8000 batches, one capture each, on the fix above:

| app | API calls | distinct colours | reading |
|---|---|---|---|
| `dx_globe` | 346804 @20000 | 320 | **draws** — lit textured sphere, some texture corruption in one band |
| `dx_flip3dtl` | 31726 | 77 | draws something; April's note recorded 628 colours, so check a longer budget before calling it a regression |
| `dx_viewer` | 181247 | 5 | runs the loop, near-blank |
| `scr_geometry` | 25506 | 1 | runs the loop, blank |

So the loader fix cleared the entry blocker for the whole cluster without
finishing any of them except globe. The remaining work is scene output, not
initialization — and note that a colour count is a weak instrument: it cannot
tell a black background that is correct from one that is a failure, which is
what made "black output" a single diagnosis for four different bugs in the
older notes.

`mcm` (Motocross Madness) now reaches a modal instead: *"has detected a change
in your game, video hardware or driver installation. We must now test your
video memory..."*. That is a dialog to answer, not a render bug — see
`tools/startup-modal-sweep.js`.
