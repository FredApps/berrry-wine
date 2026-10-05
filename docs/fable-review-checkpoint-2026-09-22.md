# Review checkpoint and shared-server regression

Current-state check after `06631548`, on the shared main worktree. This is
not a full-review completion audit or pristine-release verification.

| Pass-5 requirement | Evidence rerun | Result / remaining work |
| --- | --- | --- |
| #1 symbol owners | `check-region-decls --check-owners` | 212 owners verified. |
| #2 version authority | `check-browser-cache-versions --self-test` | One build-info/WINE_BUILD authority; 75 page scripts, seven Worker scripts. |
| #3 discovered tiers | `test-tiers --check` | 1,444 files placed: 1,085 unit, 353 e2e, six smoke. |
| #4 duplication ratchets | `aw-census --check`, `wat-dup-census --check` | A/W divergent 3, both-stub 0; 134 exact groups / 522 members, at the existing ceiling. |
| #5 shared implementations | `test-review-shared-families` | Nine named families, 21 edges, five negative controls pass. Structural evidence only; broader string-copy and COM inventories remain open. |
| #6 shared test infrastructure | `test-static-server` | **Regression found and repaired here:** three copied servers violated the existing ratchet. Control-session behavior was not rerun in this checkpoint. |
| #7 generated adapters and quiet APIs | `test-api-generation-metadata`, `check-silent-stubs` | 258 generated / one handwritten test adapter; 249 manual quiet handlers + 22 metadata stubs. WSAIsBlocking registration/semantics and remaining quiet API behavior are open. |
| #8 carried cleanup | manifest, sync-object-name and silent-history tests | 108 fragments included; shared name decoder and history separation pass. See the earlier scope-specific carried-cleanup audit; no new broad behavioral claim. |

## Regression and repair

`test-static-server.js` failed because Atomic Bomberman gameplay, the D3D9
pipeline browser fixture and the OPFS overlay browser test had reintroduced
their own `http.createServer` implementations. All three now use
`startStaticServer`; no exception or relaxed ratchet was added.

- Atomic Bomberman uses shared repository serving, MIME types, no-store and
  realpath/symlink protection instead of its copied lexical-only path check.
- The D3D9 custom route still serves its empty isolated HTML document with
  COOP/COEP headers for shared WASM memory; no repository file is served.
- The overlay fixture still allows only `/lib/overlay-store.js`; its synthetic
  test HTML remains browser-intercepted, and every other server path is 404.

Verification after migration:

- Shared-server structural ratchet and real-HTTP policy/path suite pass.
- Real Chrome OPFS test passes: 26 files survive concurrent two-tab/same-tab
  stores, reload and eager snapshot reads.
- Real Chrome D3D9 pipeline test passes shader/texture, indexed and UP draws,
  presentation and canonical BGRA pixels.
- The actual Atomic Bomberman server function was evaluated independently of
  gameplay; HTTP shell and JavaScript delivery, no-store and missing-file 404
  pass. Full Atomic Bomberman gameplay was **not** rerun.
- All three files pass JavaScript syntax and whitespace checks.

The native memory/permission, dirty-write and lifetime gaps in the other review
documents remain open. These counts and browser fixtures do not close earlier
review passes, prove all APIs correct, or establish a performance result.
