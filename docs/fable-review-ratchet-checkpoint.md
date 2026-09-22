# Review duplicate ratchet checkpoint — 2026-09-21

The Pass-5 recommendation to ratchet duplication requires lowering the ceiling
after removals, not only rejecting additions. The committed baseline still
allowed 142 exact groups and 548 named members. The current census is 138
groups and 532 members. This update records that smaller set without adding
exceptions, changing normalization or changing runtime behavior.

Before recording, the census was also run with every `src/` file read from
`git show HEAD:<path>` instead of the shared dirty worktree. At commit
`3a4c16da` it accepted the same 138/532 candidate baseline. Thus this ratchet
does not depend on another agent's pending source edits.

The 16 removed permissions comprise seven host-import signatures, three CRT
exit-handler members and six OLE lifetime-handler members. Their disappearance
from the duplicate set does not by itself prove native API conformance.

Verification:

- `node tools/wat-dup-census.js --check`: 138/138 groups, 532/532 members.
- Temporary candidate baseline capped at 137: rejects 138 groups, exit 1.
- Temporary candidate baseline omitting `05-alu.wat:$th_lea`: rejects that
  member, exit 1, with the group ceiling still 138.
- Repository baseline diff only reduces the ceiling and removes permissions.

The diagnostic near-duplicate report was also inspected; identical constant
stubs and ABI-forwarding wrappers dominate many groups. Sharing unrelated
stubs merely to reduce the count would not implement their contracts, so this
checkpoint does not alias them together. Pass-5 common-core work (#5), quiet
handler/test-call migration (#7), and carried cleanup (#8) remain partial.
The separate memory-boundary and dirty-write work is recorded in
`mapping-dirty-tracking-experiment.md`; it is not a completion claim for the
whole review.
