# Pass-5 carried cleanup: current-state audit — 2026-09-22

Scope: recommendation **#8**, not the whole review. The September 8 status
table in `fable-review.md` still calls the 09a/09c3 split open. Inspection at
`84b5fa4f` shows that this is obsolete. The shared review file has another
agent's pending edits, so this audit is recorded separately.

| Requirement | Current evidence | Finding |
| --- | --- | --- |
| Split 09a/09c3 | `09a-handlers.wat` is 877 lines and `09c3-controls.wat` is 3,011, rather than about 39,000 combined. `a1caff00` split core handlers into sound, USER, runtime, sync and late fragments. `3539626f` split wndprocs into control-family fragments; dialog fragments are separate too. `src/main.watx` explicitly includes them. | Addressed; not a demand to minimize every source file. |
| Shared `readSyncObjectName` | `lib/mem-utils.js` owns the bounded decoder. Browser `readSyncName` delegates to it; CLI event/mutex create/open calls use it directly. `test/test-sync-object-name.js` checks A/W and mutex flags, bounds, buffer types and the two callers. | Addressed for this duplication requirement, not a proof of all named-object semantics. |
| Shared PNG inspectors | All seven legacy commands delegate to `tools/png-inspect.js`. `test/test-png-inspect.js` checks delegation and exercises every entry point on a generated image, including crop exports. | Addressed; test executed on the shared tree, including another agent's pending inspector/test changes. |
| Obsolete cache fallback description | `04-cache.wat` describes the direct directory and explicitly says there is no second cache/lookup fallback. Remaining fallback references concern displaced-stream storage, not the deleted hash lookup. | Addressed; this is a documentation check, not cache-correctness or performance proof. |
| Silent-handler changelog outside gate | Regression found: 85 dated entries occupied the gate again. 58 already existed in the document; 27 additional entries are now preserved there verbatim and all 85 are removed from executable source. | Repaired in this change, with a regression test. |

Verification performed:

- `node tools/check-wat-manifest.js`: all 107 source fragments included in order.
- `node tools/check-wat-fragments.js`: all 107 individually balanced.
- `node test/test-sync-object-name.js`: pass.
- `node test/test-png-inspect.js`: pass.
- `node test/test-silent-inventory-history.js`: pass, including an injected
  dated-comment negative control. The test rejects history in the gate without
  pinning the current count as another source of truth.
- `node tools/check-silent-stubs.js`: pass, unchanged 250 manual + 22 metadata.
- Compared the checker against HEAD after removing full-line comments:
  executable source is identical. Normalized whitespace comparison also proves
  all 85 removed historical entries occur in the document.
- Tier discovery: 1,417 files, all placed; `git diff --check`: pass.

These findings close the enumerated **Pass-5 #8 cleanup scope**. They do not
close earlier passes wholesale, guarantee that every diagnostic tool works,
or constitute a new full-build/browser/performance result. In particular,
shared-core conversions (#5), quiet-handler behavior and metadata work (#7),
guest-buffer addressing, and mapped-view dirty-write correctness remain open.
The historical API claims moved to the inventory document were preserved,
not re-verified as part of this cleanup.
