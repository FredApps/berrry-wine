# Original DOS games directly in ToyVM — 7 October 2026

Source is current main ecaacf5c, not the October 5 catalog-origin commit
550d7d4a. The current CPU emitter has newer IRQ/JIT work; no claim is made that
an old generated ToyVM module is equivalent. All five original entry hashes
match their manifests; every listed file exists at its recorded size. No
payload was copied and the full large payloads were not rehashed. Exact paths,
entry hashes, source hashes and historical run IDs are in native-matrix.json.
All five remain unqualified for **native ToyVM gameplay**. DOSBox-in-Win98
screenshots are not native ToyVM evidence.

| Title | Original native entry / working directory | Path/device risks, not observed startup causes |
|---|---|---|
| Daggerfall | `FALL.EXE Z.CFG`, installed root | Bound CauseWay; 1,660 files / 541,032,586 B; nested ARENA2/save paths and six basename collisions. No DPMI/VCPI/page-table implementation; DOS pointer service remains 16-bit. Must observe which boundary this actual extender reaches. |
| Arena | `ACD.EXE -Ssbpdig.adv -IOS220 -IRQS7 -DMAS1 -Mgenmidi.adv -IOM330 -IRQM2 -DMAM1`, original D: root, `ARENADATA=C:` | Real-mode entry; original config mounts same payload as CD drive; MSCDEX absent. SB220/IRQ7/DMA1 requested; General MIDI330 unimplemented. 386 files / 52,534,276 B, 173 nested paths, no basename collision. A CD mount in the recipe does not prove this entry calls MSCDEX before it can play. |
| Ultima IV | `ULTIMA.COM` → `TITLE.EXE` / `AVATAR.EXE`, C: root | Real mode; 146 original catalog files / 889,342 B. Native title and Enter-responsive main menu observed Oct5, not character creation/world. Four authentic initial save files omitted by wrapper exclusion; scoped fix below. EGA/VGA and keyboard have existing coverage. No CD/MPU requirement recorded. |
| Shadow Warrior | `Sw.exe`, installed/app C: root; original `GAME.DAT` mounted as D: ISO | Bound DOS/4GW; 161 files / 376,144,401 B, eighteen basename collisions; MSCDEX/CD image support absent. Whole release contains expansion branches: collisions alone do not establish which files this particular route opens. |
| GTA demo | `GTADOS/K.EXE` from GTADOS; original GTA.BAT changes directory first | External DOS/4GW launcher plus bound DEMO24/DOS4GW, seven basename collisions, 117 files / 17,078,619 B. Original requirements name VBE2 LFB; ToyVM offers banked VBE1.2. No command interpreter/batch support. Need actual launch/failure evidence rather than infer all extender functions are required. |

## Current source contracts

- `tools/toyvm/dos.js:3526–3533`: DOS INT21, XMS multiplex INT2F,
  mouse INT33 and EMS INT67 are dispatched; no INT31 DPMI handler.
  `int2f:5155` handles XMS43xx and Windows-presence1600, not1687 DPMI
  discovery or MSCDEX15xx. Do not describe the unhandled1687 path as a
  dedicated fully implemented absence protocol.
- `dos.js:5325–5402`: EMS services, no VCPI DExx. `emit.js` MOV-CR
  implementation still retains CR0 only, dropping CR2/CR3 writes; no actual
  page translation. The dated catalog's statement that DOS/4GW/CauseWay
  "cannot start" is a static expectation, not a native run verdict.
- `dos.js:2108`: protected selector base is honored, but the offset is
  masked to16 bits; a 32-bit flat DOS buffer is not generally implemented.
- `dos.js:1252`: lookup strips drive/directories and searches one host
  directory. AH47 reports root; AH39/3B absent. `bundle-browser.js:148`
  likewise mounts by basename. Browser cannot represent colliding paths.
- `dos.js:3803–3921`: banked VBE1.2, LFB requests refused. XMS, EMS, SB,
  OPL and GUS implementations exist; this does not certify any game's audio.
- `ops/toyvm-live/live.js:215–216`: native page forwards keyboard but pointer
  down only focuses canvas. `tools/toyvm/live.js` has no mouse input API;
  CLI INT33 support is not browser mouse delivery.
- Existing opens read full files synchronously; the native page preloads and
  hashes all listed files before boot. Large payload loading remains a
  separate gap. Do not reuse Win98 lazy-file claims here.

## First concrete correction: original Ultima IV support files

`__support/save/{DNGMAP.SAV,MONSTERS.SAV,OUTMONST.SAV,PARTY.SAV}` exists in the
original release (512/256/256/502 bytes). GOG's original config mounts its
cloud_saves overlay. The native catalog excluded __support wholesale, unlike
the already corrected DOSBox packaging. The patch names exactly these four
source paths plus their root guest names. Existing browser basename mounting
puts them at native C:\ filenames. No wrapper directory exemption, synthesized
save, altered EXE or guest memory write is introduced.

**PARTY.SAV is not blank.** It contains named original character records
(Mariah, Iolo, Geoffrey, Jaana, Julia, Dupre, Shamino, Katrina). SHA256
f647ceab6d0e9dd619335988e0dfd5dfdc5b1d7690f9eac1cf686d32f04a0acb.
An ordinary Journey Onward route would start packaged state and must be
labelled that way. Claiming character creation requires visible Initiate New
Game, actual answers and resulting world. Original assets remain read-only;
existing DOS writeFile clones originals to in-memory tempFiles. Persistence
across browser reloads is not implemented or claimed by this change.

Pure-JS validation passed the actual page launcher, committed browser mount,
and actual DOS open/write/reopen methods without running guest instructions or
compiling/instantiating WASM. Negative control without the four inputs fails
on real native DOS open of DNGMAP.SAV. Wrong-path, collision, absent file and
outside-root symlink cases fail closed. Selected regeneration now merges one
row into the existing five-title manifest; the actual four unrelated rows
remain deep-equal. No full541MB scan. U4 is150 files /890,868 B after inclusion.
Final source checks: existing corpus synthetic tests passed (full payload freshness intentionally skipped); U4-only freshness passed; empty --only is rejected before scanning. Actual titleView URLs containing __support/save pass through the unchanged page launcher to root DOS names. The expected negative control fails on missing DNGMAP.SAV. Exact logs are retained in scratch/toyvm-dos-native-20261007; durable hashes/receipt accompany this handoff.

## Requested next probes — not launched

1. First native U4 browser route, at most180s total, original150-file manifest
   and current committed ToyVM bundles with exact source hashes. Use existing
   `/toyvm/?title=ultima4` private authenticated-equivalent handler, no Windows
   wrapper or engine override. Ordinary Start → Enter → visible Initiate New
   Game; stop on concrete error or budget. Retain frame/input/runtime console,
   DOS file-open/missed and temp-file metadata via existing read-only state if
   available. World plus ordinary direction response required for gameplay.
   If only Journey Onward is chosen, explicitly label original packaged save.
   No callback/state injections, auto-answer mode or artificial save bytes.
2. Two separate native CLI census probes, <=30s execution each inside a <=90s
   serial supervisor including compile/startup/cleanup; no JIT/performance A/B.
   Current source only, original entry/args/env, `--dispatches=50m --seconds=30
   --report --trace-entry=20 --trace-fault`; bounded stdout200KiB while draining,
   final report/PNG and source/entry identities. Parent must grant this lease.
   Paths are read in place; no file copies or guest writes to originals.
   - Daggerfall: `node tools/toyvm/run-dos.js <absolute installed>/FALL.EXE
     --args=Z.CFG` plus flags above.
   - Arena: `node tools/toyvm/run-dos.js <absolute installed>/ACD.EXE
     '--args=-Ssbpdig.adv -IOS220 -IRQS7 -DMAS1 -Mgenmidi.adv -IOM330 -IRQM2 -DMAM1'
     --env=ARENADATA=C:` plus flags above.
   These are launch census probes, not exact multi-drive emulation: ToyVM's
   flat root remains explicit. Identify first actual unhandled interrupt,
   instruction fault, file miss or stable wait and reported CS:IP. A budget
   exhaustion alone is unknown, not an extender incompatibility verdict.

No native guest, browser, engine build, benchmark, deployment or Claude session
was run for this audit/fix. Hype/PBO/Win98 evidence is unrelated to native game
qualification.
