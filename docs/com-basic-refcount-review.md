# Basic COM reference-count aliases — 2026-09-22

Pass-5 #5 calls for shared COM AddRef/Release implementations and generated
per-interface dispatch. DirectMusic still duplicated the basic DxObject
counter operations; AMMultiMediaStream and GammaControl delegated through
private DirectMusic wrappers rather than the existing canonical endpoints.

Six `api_table.json` entries now select `dx_com_addref` or
`dx_com_release_basic`. The generated dispatch changes accordingly, and all
six private wrappers are removed. Shell Link and IPersistFile's two direct
AddRef callers now call the canonical AddRef endpoint too. Their specialized
`shell_link_release` teardown remains unchanged. No DirectPlay, surface,
texture, device, storage or callback-owning release was generalized here.

The shared basic release stores the decremented count before final `dx_free`;
the removed DirectMusic implementation only stored it on a non-final release.
There is no interface-specific teardown between that store and slot retirement.
The tests verify observable live-reference counts and final retirement.

Verification:

- `test-directmusic-query-interface.js`: **42 passed**, including 18 new
  lifecycle checks. All six API IDs run through `dispatch_api_table`, not
  direct helper calls: initial reference 1, AddRef 2/3, Release 2/1/0,
  exactly eight bytes of stdcall cleanup, and restored live-object count.
  Metadata assertions retain the six aliases. Existing full-GUID rejection,
  QI-owned references, factory aggregation/error paths and lifetime tests pass.
- `test-am-multimedia-stream.js`: creation/probe/release passes; the test's
  release now also uses generated dispatch rather than a removed wrapper.
- `test-directdraw-gamma-ramp.js`: shared gamma-ramp state passes.
- `test-shell-link-com.js`: Shell Link/IPersistFile persistence passes.
- Generator freshness, append-only API IDs, metadata generation, handler
  cleanup and silent-handler gates pass. Quiet inventory stays 249 + 22.
- Fragment balance, logical operands, tier discovery and whitespace pass.
  The exact-duplicate baseline tightens from 138 groups / 532 members to
  135 / 524. Removed members are the six deleted wrappers, the now-singleton
  Lobby2 Release, and the already-implemented GetPrivateProfileStructA;
  no new duplicate is allowed by this update.

This addresses these remaining basic-counter copies, not all COM reference
counting. Specialized teardown, controlling-IUnknown identity and concurrent
AddRef/Release correctness remain separate contracts. No browser or
performance benchmark was performed; tests use the shared worktree.
