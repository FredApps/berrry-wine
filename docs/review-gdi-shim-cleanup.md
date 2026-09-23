# Import-era GDI shim cleanup

2026-09-23. Addresses the dead-wrapper portion of `fable-review.md` P2-2
(item1.5) and the later mislabeled-header finding. The review's historic
23-dead-wrapper count was rechecked rather than treated as current.

## Removed

The current source had22 `$host_gdi_*` definitions with no other production
symbol references (calls, exports, table references or otherwise). They were
native WAT wrappers, not imports. Deleted106 lines from `01-header.wat`:

```text
create_pen             create_bitmap          create_dib_bitmap
get_object_bits        get_object_storage     get_object_bpp
rectangle              create_rect_rgn        set_rect_rgn
combine_rgn            offset_rgn             ext_select_clip_rgn
exclude_clip_rect      get_rgn_box            polygon
polyline               polyline_to            get_line_descriptor
get_clip_box           frame_rect             get_pixel
ext_flood_fill
```

Each name above had only its definition in production WAT. A second search
across tests/tools/lib found two injected-WAT test callers of `get_pixel`.
Both now call `$gdi_hdc_get_pixel` directly, exactly the deleted wrapper's
body with the same arguments/results. A negative source assertion mentioning
`host_gdi_polyline` remains intentionally. No live API handler, host import,
underlying native GDI helper or rendering algorithm was removed.
Native shim definitions in this header fall69->47; all7 real GDI imports remain.

The existing core architecture regression checks that these22 symbols stay
absent across all source fragments, so moving an obsolete wrapper cannot hide
its return. A negative control injecting `$host_gdi_create_pen` into the
test's scanned text fails at the expected assertion. This is a targeted
regression, not a general call-graph/dead-code analyzer.

## Verification and remaining scope

- `test-core-no-app-fast-paths`: pass, including the manual negative control.
- `test-caption-active-state`: pass (foreground A/W, flash, child, NULL).
- `test-dialog-button-command-queue`: pass (main-pump modal button commands).
- Fragment balance109 and duplicate ratchet117groups/467members pass.
- Full shared-tree build passes: normal1,506,142 bytes, compat1,508,548 bytes,
  unchanged layout `68ce5b9062e11919`. Log:
  `/private/tmp/wa-gdi-dead-shims-build.log`. Tier1499 and diff checks pass.

Remaining live `$host_gdi_*` wrappers still need the separately scoped rename
and relocation out of `01-header.wat`. This cleanup does not claim that the
whole header split, GDI ownership migration, or `fable-review.md` is complete.
No performance benchmark was run; removing unreachable wrappers is not proof
of a gameplay speed improvement. Deleted code is recoverable from git history.
