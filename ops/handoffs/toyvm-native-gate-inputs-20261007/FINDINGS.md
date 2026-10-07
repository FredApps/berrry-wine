# Native Daggerfall gate-input observation — 2026-10-07

Diagnostic session1955, PID2522766,10:33:22.177–10:33:25.626Z. Original3s
guest bound, child18s inside20s lease; exit0, no forced signal, PID absent.
No browser, Arena repeat, gameplay, or performance result. Exact source and
modified module89d400ba remain those previously validated.6 distinct PM rows,
no cap/read errors. Step wrapper and private emitter restored successfully.

After the first PM row (TR=0), actual TR is0x23. Raw TSS descriptor resolves
base0x188f0, inclusive limit0x174. Captured32B prefix:
`00000000fc000000300000000000000000000000000000000000000007900100`.
Actual ESP0=0xfc, SS0=0x30; SS0 descriptor `ffff608901924000` gives
base0x18960/B=1. Before5b:1204, SS30:ESP80; at next4b:13ad, SS30:ESP7e.
Do not equate that observed stack delta with a complete call-gate frame.

Captured predecessor disassembles to an ordinary near CALL5b:1384 at121b.
The retained256B region begins1204 and ends1304, so that target is outside it.
No executed far-transfer opcode was captured; the prior gate-descriptor
misinterpretation evidence stands but this exact instruction remains unknown.

Read-only exact search of original FALL.EXE SHA0c89487d found zero matches for
all6 full256B code spans and all30 selected16B subspans. Search receipts retain
each pattern/offset. This rules out the attempted direct byte mapping, not all
possible unpacking analysis. There is no justified file-offset translation
for target1384. The completed child retained no full VM memory snapshot. No
additional run was made to extend the read range.

CALL-GATE-DESIGN.md maps the general architectural contract to actual handlers
and tests. A production fix is not authorized or included. Notably ordinary
PM fault delivery and RETF privilege return need truthful handling, alongside
target/TSS/stack validation; the VM86 helper has a different frame. Paging,
flat drive/directory lookup and DOS/device contracts remain independent.

Reader/test source copies here are immutable evidence; original runnable
helper paths are in ready-source.json. `.valid` denotes bounded mapped bytes,
not valid architecture. An SS0 LDT selector would be unsupported by this
GDT-only diagnostic, not declared invalid. Test used synthetic memory only.
