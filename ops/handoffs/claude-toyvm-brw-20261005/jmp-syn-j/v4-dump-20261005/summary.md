# v4 code dump + state window at 330.588M (root grant 13:32:41Z, 15 s, private HEAD+combined+v4)

Dump: 8:be00-c400 (csb 0x1f80, linear 0xdd80, 1536 bytes) at d=330588011, byte-identical in both arms. Offline 32-bit disassembly: disasm.txt (disasm.js).

- The code at 8:c179-c37x is a texture-span routine that SELF-MODIFIES its inner loop: c30f-c314 copy [0xc3a0] into [0xc35d], the immediate of `add al, imm8` at c35c inside the span loop c34b-c36x (likewise the stepping immediates nearby). The loop also has an `idiv ecx` at c198.
- No installed region covers c179-c37x (jit-sepc heads by then: 0x8c77 0x8cc6 0x8d15 0x4481 0x423a 0x8d64 0xee2d 0xea5e 0x7b94 0xef0b 0xea8c 0xefdf 0xeac7 0xeb02). Both arms run it through the block cache.
- By 330588272 L1 has taken 13,124 SMC breaks and jit-sepc 13,121 (3 fewer), with one extra arena reset (6 vs 5).
- The register split is exactly in that loop's stepping: si f901 (L1) vs f67b (jit-sepc) at 8:c34b.

Hypothesis (unconfirmed): in the region arm, 3 self-modifying writes into this routine did not break and re-decode, so a block with a stale immediate ran. Candidates: a store executed INSIDE a region not checked against the code bitmap, or the code bitmap / jump table after an arena reset. Next (slot): log every SMC break (dispatch, writer, address) in both arms to 330.6M and diff them.
