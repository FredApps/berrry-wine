# TDR2000 original-media first launch, 2026-10-07

Carmageddon TDR2000 Alpha Test Demo, distinct from Carmageddon2. Original
installer assets were extracted, then authenticated loose overlays hardlinked
into installed view. No game payload is included here. Source notes and input
route are in docs/re-notes/carmageddon-tdr2000-demo.md.

Current-main f1de9742 full gates passed; module992a8b02. Corrected ordinary
browser attempt2 reached original hardware profiler and launcher, then ordinary
Start repeated FAILED: IntegrityCheck and guest exited after OK. No race/control
qualification. Cleanup complete, requests/errors preserved (not an errors-free
network claim). Attempt1 launched Notepad through a missing debug-dropdown
option and is explicitly invalid game evidence.

Raw source/run/inputs/6screenshots remain in
scratch/wt-tdr2000-demo-20261007/scratch/tdr2000-preparation/browser/attempt2.
The artifact manifest hashes22original run files;293full HTTP200 response hashes
matched expected source/original files, no unknown complete200.69ranges retain
per-range receipts, not claimed as full-file hashes.

## Exact static next investigation

Authentic final EXE SHA8b15bee96560f31d447757067c7eaca90163a57c61b9436a6fd564453189ded4, preferred imagebase400000. IntegrityCheck is4e5e80; caller4e5b69 selects
the exact failure text only on negativeEAX. Four failure conditions exist: zero
object+840, zero OR820/824/828, empty virtual+48 format count, or no bit0 accepted
format from virtual+4c(index). No live object snapshot established which one.

Producer4e5f00 clears80c..844, then reads field964 to populate820/824/828 from
per-stage MIN/MAG/MIP filter bits (0x100/200/400,0x01000000/02000000/04000000,
0x10000/20000). If field964 receives current D3D7 triangle filter caps, all
three remainzero: d3dim_fill_device_desc7 calls fill_primcaps, whose filter caps
are only0xFF. This is a concrete advertisement mismatch candidate, not physical
GPU exhaustion, checksum corruption or an established optional-DLL cause.
Confirm exact GetCaps destination/interface and renderer's supported filter
semantics before adding only truthful caps; don't OR arbitrary support bits.

Microsoft documents distinct per-stage MIN/MAG/MIP capability flags in the
[legacy D3DPRIMCAPS contract](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/d3dcaps/ns-d3dcaps-_d3dprimcaps).
Real-handler regression should invoke actual D3D7 caps path and independently
check only implemented point/linear stage support, retaining legacy contracts.
No proposed engine patch is part of this evidence commit.
