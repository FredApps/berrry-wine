# Antara original hover/action contract

Isolated branch `findings/antara-hit-state-20261008`, coordinator base
`e612e3e75`; prior `f418f6405` branch preserved. Source/JS only so far.
No native/build slot or shared HEAD/index used. Root reviewed the observer
at 01:17:55 and granted queued remote 240s transfer / 120s browser / 90s cleanup
after Alien Shooter actual release and independent resource checks.

Original `_SETUP.EXE` SHA `a11e70704b15c12424e771a1b7c331396f69644d7cb1f53a7a5b3999f9309bb4`
contains ten-byte message-map records at segment1:a35a/a364. The original
selector relocation chain17 maps DOWN `0201` to **4:243c** and MOVE `0200`
to **4:2330**. These are original static mappings, not live selector005f proof.

MOVE requires object+1c6 nonzero, stores its packed point at +1e2/+1e4, then
writes selection +1e6 at4:240d. The first row requires signed x>=380 and
135<y<150, selecting1; actual previously measured408,144 fits those bounds.
DOWN reads +1c6/+1e6 rather than recomputing the point. Selection1 calls
3:dad6 at4:2488; its exact action progression remains unobserved. Fallback
2:120a returns4:24e8. Previous driver motion preceded activation, and previous
observer excluded MOVE, so previous unchanged Install captures cannot diagnose
this state transition.

The bounded existing observer now includes MOVE and USER125 InvalidateRect,
which the original hover handler calls at4:2422 after selecting. At USER122
mouse/default calls or USER125, it retains up to three ascending saved BP frames,
256-byte saved caller spans, a candidate object header and36 bytes beginning
at+1c4. Candidates derive from actual frames and the owning SS; no historic
selector/object address is encoded. Every copied byte, getter and translator
crosses deadline guards. All original import forwarding, ACK checks,8s deadline,
65536-word/100ms phase caps,128-row/32KiB caps and UP reservation remain.

`tools/antara-menu-contract.js` verifies original identity/NE bounds and chained
relocations. Its actual-receipt analyzer authenticates original caller bytes,
saved4:24e8 bytes, critical internal relocation4:24e6 back to authenticated
originalsegment2, and matching candidate object pointers before interpreting
gates. Hover InvalidateRect authenticates exact original4:2427 caller. Relocation
sites outside the critical internal call are explicitly exempted from byte
identity; full API thunk relocation-target authentication is not claimed.
API snapshots occur after application handling and are not callback RETF.

Prepared immutable evidence will be
`scratch/runs/20261008T0123Z-antara-hit-state-ready`: original503 archive
hardlinked, two private JS overlays, same sourcef62/module4dc5 and original
media;505 pins,535 HTTP HEAD,5 SHA GET, range, exact optional404 and stream
drain passed. Actual generated driver test executes ACK→ordinary4stepMOVE→150ms
settle→DOWN→UP-ACK→UP, and proves failed ACK sends no mouse input. The caller
and selector authentication tests reject corrupted code, wrong critical selector,
different object, malformed/cyclic chains and allocation-only segment aliasing.
Ordinary motion targets the previously reviewed visible Install coordinates;
no guest writes, forced controls/returns or application selection overrides.

Runtime remains queued; gate values, selector mapping, installation and gameplay
are unmeasured. Stay in this worker through the authorized run. Read latest
board/resource state; never reuse a package or prefix with stale/mismatched pins.
