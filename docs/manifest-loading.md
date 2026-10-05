# Sized local asset manifests

A schemaVersion1 local browser manifest may give each entry a safe integer `size` (bytes) and `loadMode`:

- `required`: fetch bytes before launch; failure rejects launch. Native modules and fonts remain required in generated lazy trees.
- `lazy`: mount an HTTP range provider with its declared size. Mounting performs no HEAD or GET. A guest read fetches the missing64KiB chunk through the existing parked-read Loading/Retry/Quit UI. No eager fallback is hidden behind this mode.
- `background`: mount identically, then after the guest starts warm the first64KiB of up to eight explicitly marked files, serially. Remaining files stay on demand and are counted as deferred. Errors are recorded on `wine.backgroundAssets`; later guest reads retain retry behavior. Stopping the app aborts pending range requests and prevents further warmup jobs. Background is not a whole-file or whole-tree prefetch.

Legacy entries without loadMode keep their existing behavior. Existing `httpRange` discovery and measured `preloadRanges` are unchanged. Explicit lazy/background modes cannot also request synchronous image decoding or launch preloads. Aliases of the same URL share one provider; contradictory size/mode declarations fail validation. A provider's lifetime signal is separate from the launch download signal.

Candidate preparation (`tools/fetch-candidate-corpus.js --id=ID --prepare`) emits exact stat sizes. A candidate's browser policy can set `defaultLoadMode` and per-relative-path `fileLoadModes`. Regardless of a lazy default, EXE/DLL/OCX/VBX/DRV/TTF/TTC/FON stay required. Both Dredmor candidates opt in; no game bytes are committed. Regenerate the ignored local manifests when changing policy or fixture contents. The served server must support206 responses for the declared single-file URL; wrong sizes/range failures surface on read, not as a successful eager fallback. Split-release URLs still use the legacy discovery path unless explicitly prepared as independently sized assets.

Validation includes actual host/VFS mounting of6000 files with zero startup requests, sparse reads, aliases, metadata rejection, cancellation, required failures, background bounds/stop/errors, and actual preparation with native/font classification. This establishes loader behavior, not Dredmor startup or gameplay compatibility; those require a recorded ordinary launch.
