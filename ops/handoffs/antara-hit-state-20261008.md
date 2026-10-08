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

## Actual runtime and phase close

`scratch/runs/20261008T0122Z-antara-hit-state-runtime` ran the exact committed
four-step observer/driver51737222e, with Worker a5828295 and unchanged Link268a.
Hover USER125 returns to original4:2427; its actual96-byte caller span matches
originalsegment4 except original relocations. Thus selector005f/base1a0000 is
authenticated as segment4 at this boundary. Frame-derived object008f:655a has
gate+1c6=011c, point+1e2/+1e4=408,144 and selection+1e6=1. Install turns white.
This establishes successful application hover selection, not installation.

Four intermediate ordinary moves consume the64 DOWN-phase row allowance
before DOWN. Child receives the correct host DOWN packet but reports5 omitted
DOWN-phase records; a missing routed DOWN or failed action cannot be inferred.
Child1136words/12316bytes/error0,72 retained rows, no partial frame; UP routes
and its original default API call returns0. Poller hits both65536-word caps,
rows0. Original menu remains highlighted, with no installation or gameplay.

Ordinary close01:26:29.798 before original01:27:16 deadline. All27 actual files
copied and SHA checked,22545/22567 absent/noChrome/exactfreshbaseline sockets,
505 unchanged pins and49GB floor verified. Prefix removed01:27:21; actual
release posted01:27:28. Fresh noenv box bx_qms4q3z7 expiry01:53:20 and retained
Puppeteer were adopted by root/queued Tiberian; do not delete during ownership.

Root01:28:18 requested a tested source correction then EXIT, no rerun. The next
driver uses one ordinary move with **hover ACK then fresh DOWN ACK before the
press**, retaining the original8-second absolute deadline. Independent quotas
are hover32rows/8192bytes/32768words/50ms, DOWN32/8192/32768/50ms,
UP64/16384/65536/100ms. Their totals equal the old128rows/32KiB/131072words/200ms
ceilings. A hover raw cap can restore tracing, then the authenticated DOWN ACK
rearms its separate budget without extending the deadline. Legacy direct
DOWN/UP activation remains tested. Flood regression reproduces the old shared
hover/DOWN row loss, then proves5000 MOVE frames cannot consume the reserved
DOWN/action-frame or UP allowance; CPU,byte,word,row totals remain bounded.
Generated-driver regressions reject hover ACK and DOWN ACK independently.

This correction is source/JS tested and **not browser tested**. The executed
runtime evidence retains four-step identities. The next original boundary is
4:2488→3:dad6 Install handling, or authenticated default4:24e8 with gate fields;
ordinary DOWN handling remains unmeasured beyond its host packet. Static
3:dad6 calls USER46 GetParent, USER42 EnableWindow, USER59 SetActiveWindow and
USER124 UpdateWindow, then internal5:32a4; those three extra USER imports are
not retained by the current observer. Any further collector extension needs
root review, precise caps and original-code authentication. No generic guest
defect or production patch is established. Next fresh phase follows the root
queue after Tiberian/Warcraft; never reuse stale packages or prefixes.
