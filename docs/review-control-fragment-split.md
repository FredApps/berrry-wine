# Review P5-8: common-control wndproc split

2026-09-19: split the 9,327-line `src/09c3-wndprocs.wat` at existing
top-level section boundaries. Function/data order and all function bodies
are preserved; only a blank separator line differs in the concatenation.

| Fragment | Responsibility |
|---|---|
| `09c3-wndprocs.wat` | ListView |
| `09c3-wndprocs1-toolbar.wat` | Toolbar |
| `09c3-wndprocs2-tooltip-trackbar.wat` | Tooltip, TrackBar, shared owner-draw helpers |
| `09c3-wndprocs3-listbox.wat` | ListBox |
| `09c3-wndprocs4-combobox.wat` | ComboBox and dropdown popup shell |
| `09c3-wndprocs5-edit.wat` | Edit and multiline helpers |

`src/main.watx` remains the sole include-order authority. The sole affected
region owner, `$edit_layout_len`, now names the Edit fragment; no region
extent, address, or generated mirror changes. CLAUDE's source map and the
basic-controls cross-reference are updated. This is an organization change,
not a control-behavior fix. Other oversized files, including 09a handlers,
OLE and DirectX, remain; the broad review split item is not fully closed.

## Verification

- Concatenated source matches the original after ignoring blank-line runs.
- Compile the complete current source twice: once with the original monolith
  injected at its old position and the five new bodies empty, once normally.
  **Complete WASM buffers are byte-identical** in both tail-call and
  compatibility modes (1,441,967 and 1,442,873 bytes in that snapshot).
  This checks function indices and data ordering, not only module validity.
- Full `bash tools/build.sh` passes all gates and both builds, including
  owner attribution, manifest ordering, control variants and data overlaps.
  Another agent is editing Win16 in this shared tree; the independent full
  build's sizes differ from the paired-compile snapshot, so they are not
  presented as the same artifacts.
- Toolbar width, parent/child paint, property-sheet page lifetimes and Unicode
  Edit text regressions pass.

Local evidence: `/private/tmp/wa-control-fragment-equivalence.log`,
`wa-control-fragment-build.log`, `wa-control-split-toolbar.log`,
`wa-control-split-paint.log`, `wa-control-split-page-handles.log`,
`wa-control-split-edit.log`.
