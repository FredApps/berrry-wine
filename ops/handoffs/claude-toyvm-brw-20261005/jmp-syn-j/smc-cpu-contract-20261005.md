# Forward-SMC findings against the CPU contract (2026-10-05 ~14:40Z, source-only)

Root's caveat (main 2e167d67): Intel SDM 25366821 sections 7.1.3 and 10.6 describe self-modifying
code as model-dependent. A 386/486 can execute bytes already in its prefetch queue, and only a jump
or serializing instruction guarantees the modified bytes are fetched. My earlier line "on x86 a store
into an instruction ahead takes effect before it executes" was too broad. It holds for P6-class
snooping, not for the 386/486 prefetch model. toyvm runs BRW with `cpu: 386` (run-dos.js:218) and
has no written SMC/prefetch contract. Its existing behaviour (end_smc on CS-override stores,
PATCH_AHEAD = 256) honours forward patches more eagerly than a 386 would.

## BRW's routine: stale execution is wrong under the 386/486 model too

Disassembly of the dumped code (`v4-dump-20261005/disasm2.js`):

```
c314  mov [0xc35d], al     ; patches the imm8 of `add al,imm` at c35c
c319..c33c  four more stores into c360, c366, c36b, c371 (straight line, no jump)
c341  mov ecx,[0xdcd9] ; c347 mov ax,0
c34b  span loop: ... c356 jz c35a ... c35c add al,<patched> ... c367 jnb ... back edge
```

The first store's target (c35d) is 0x49 bytes ahead of it, beyond a 386's 16-byte and a 486's
32-byte prefetch queue, so a real 386/486 fetches the NEW byte. Every later iteration re-enters
through the loop's back-edge jump, which flushes the queue. So on real hardware the routine runs
the patched immediates. The interpreter running the stale copy (the pure volatile compile) is wrong
under any x86 contract, and the BRW forward-SMC fix stands on architectural grounds.

## The same-block synthetic: NOT a universal defect

repro2's same-block form stores into an imm8 5 bytes ahead with no jump between. That is inside
the 386/486 prefetch window, where executing the old byte is permitted, so toyvm's result (old byte)
can match the 386/486 contract. Whether to change it depends on the intended CPU contract. If the
target is a Pentium-class SMC-snooping CPU, it is a defect; if it is the 386/486 the corpus mostly
targets, prefetch-window semantics are arguably correct. TOYVM-SMC-SAME-BLOCK-FORWARD-PATCH is
reclassified as a contract decision, not a mandatory fix.
