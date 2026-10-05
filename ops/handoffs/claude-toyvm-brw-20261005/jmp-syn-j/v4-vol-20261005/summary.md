# Volatile-compile confirmation (root grant 13:57Z, 12 s, private HEAD+combined+v4)

Per handback 330587900-330588260: the cache's volatilePure / volatileCompiles counters and, for linear paragraphs e0f9 (8:c179 entry), e294 (8:c314 store) and e2dd (8:c35d, the patched immediate): volPara, programs holding the paragraph, and the code-bit byte.

- L1: e2dd turns volatile at 330588088 and from then on has bits=0 and no holder, while volatilePure rises at every handback (3289 -> 3292). L1 enters at 8:c290 and runs a PURE volatile compile (code bits down) that covers the store at c314 AND the span loop at c34b..c36x after it. The store writes c35d, ahead of the PC in the same straight-line program, nothing breaks, and the immediate compiled before the store runs.
- jit-sepc: a different paragraph went volatile (e0f9, the c179 entry); volatilePure barely moves (3129 -> 3131); e2dd's bits are set again by 330588242, so its writes break and the loop is re-decoded.

Conclusion: the dos-loop.js pure-volatile assumption ('stores land behind the program counter', ~817-848) is violated by a forward self-patch inside one straight line, and L1 then executes stale code. Root's caveat stands that smcFlush only flushes detected writes and is not an independent oracle. The correctness claim does not rest on it: on x86 a store into an instruction ahead in the stream takes effect before that instruction executes, so a compiled program that bakes the old byte and runs it after the store is wrong by architecture.

Next: a toyvm-only failing test (a straight line that stores an immediate into an instruction later in the same line, on a paragraph that has gone volatile; assert the patched value is used), then one of the fix options in v4-gt-20261005/summary.md. Both are L1 behaviour changes, so they need the user's sign-off and the corpus A/B. Nothing promoted.
