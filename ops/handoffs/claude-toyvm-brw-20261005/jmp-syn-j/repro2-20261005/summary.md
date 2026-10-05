# Reworked forward-SMC reproducer (root grant 14:14, 2 s, private HEAD / HEAD+fix / HEAD+fix+TOYVM_PURE_CLEAR_ALL=1)

Answers root's 14:13:39Z review caveat (within-block vs transfer-separated).

| form | HEAD | HEAD+fix | fix+control |
|---|---|---|---|
| transfer-separated (store; jmp; patched add): BRW's shape | PASS (dl 132) | PASS | PASS |
| same block (store; patched add, no transfer) | **FAIL** dl 188, want 132 | **FAIL** 188 | **FAIL** 188 |

- SAME BLOCK: a stale forward-patched immediate runs on HEAD in every mode, INCLUDING smcFlush (also 188). That is a pre-existing, general forward-SMC gap: `$smc` is acted on at the next block transfer, so the rest of the storing block runs with the bytes it was decoded with. Only a CS-override store ends a block (end_smc). The fix neither causes nor repairs it. On x86 the new byte would execute, so the test is right to fail.
- TRANSFER-SEPARATED: it does NOT reproduce the BRW bug. All 200 calls take an SMC break in every arm (cached 200, smcFlush 200), so this program never reaches the pure uncached compile. Something about BRW's case (promotion and entry conditions, run length, the hash-stale demotion) is not captured yet.

So: the forward-SMC fix is evidenced only by BRW (330.588M window: L1 matches jit-sepc with the fix, 7d0423ee). General forward-SMC correctness is NOT established: the same-block form fails everywhere and needs its own fix (a store into the storing block's remaining bytes ending the block, end_smc for DS-relative stores, or a re-decode on $smc at the next instruction). Narrow BRW repair and general correctness are separate items; neither is promoted.
