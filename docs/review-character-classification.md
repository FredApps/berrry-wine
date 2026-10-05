# Review P5-3: shared IsChar predicates and real runtime coverage

2026-09-19: six IsChar wrappers now share `$is_char_type(ch, mask, wide)`.
It selects the existing ANSI-byte or Unicode-WCHAR classifier, applies the
requested CTYPE1 mask and normalizes BOOL. Each public handler retains its
one-argument stdcall cleanup. ANSI arguments still discard upper 24 bits;
WCHAR classification still discards upper 16 bits.

This removes repeated wrapper logic without conflating encodings: CP1252
0x8A is S-caron, while Unicode U+008A is a control character. The underlying
tables are unchanged. In particular, the Unicode table remains limited to
ASCII/Latin-1 and the CP1252-only additions; this is **not** a claim of full
Unicode or all-locale Win98 conformance.

The A/W census now identifies IsCharAlpha/IsCharUpper as shared. Their two
baseline entries are removed, reducing DIVERGENT from five to three; remaining
entries are GetCommandLine, wsprintf and wvsprintf. No census heuristic or
allowance was loosened.

## Verification

The former `test-is-char-alpha.js` inspected source with regular expressions
and tested independent JavaScript copies of the predicates. It never called
the actual WAT handlers, so its green result was weak behavioral evidence.

The replacement test compiles the source and invokes all six public handlers:
all 256 ANSI bytes for four handlers and all 65,536 WCHARs for two, each with
and without high promoted-argument bits. **264,192 real calls** check the
classification table relationship, exact 0/1 result and ESP cleanup. Independent
ASCII/CP1252/WCHAR fixtures also check the table itself at encoding boundaries.
Both the original and refactored WAT pass. A negative variant routing Unicode
through the ANSI table fails specifically at IsCharAlphaW(U+008A).

The complete build passes both WASM modes and all gates. The wide-API suite
passes 33/33 and the locale-info runtime regression passes as well
(`wa-char-wide.log`, `wa-char-locale.log`). Local evidence:
`/private/tmp/wa-char-before.log`, `wa-char-after.log`, `wa-char-negative.log`,
`wa-char-build.log`. No native performance or broader Unicode claim is made.
