# American McGee's Alice demo

## Original-media preflight (2026-10-09)

Original: `test/binaries/win98-games-a-d/american McGees-alice_demo-OpenGL.exe`,
82,499,584 bytes, SHA256
`ce873bf2525041a624c1a5a27b513f135b51ffdbeae9f68a6ede3edd8c7078e6`.
7-Zip recognizes its WinZip self-extractor: 15 files, two directories,
85,622,092 uncompressed bytes. It contains `alice.exe`, `demo/cgamex86.dll`,
`demo/fgamex86.dll`, `demo/pak0.pk3`, and Miles sound drivers. The included
readme identifies the November 27, 2000 demo. No installer execution is needed
to obtain these original files.

No Alice/McGee registration, task, or gameplay run directory was found in the
current registry, TODOS, board, and retained run-name search. This is a queued
new-game candidate; no launch or gameplay is claimed. BW2 remains compatibility
coverage rather than being counted as another previously unqualified title.

Static import audit reports 212 imports in `alice.exe`, including five missing
API-table rows: `midiInStart`, `midiInOpen`, `midiInGetDevCapsA`,
`midiInGetNumDevs`, and `midiInClose`. Each gameplay DLL has 77 imports and no
missing/explicit fail-fast handler reported. Static imports do not establish
that these functions execute; do not add silent stubs based on this scan.
Dynamic OpenGL/Miles lookup and actual runtime behavior remain untested.

Preflight hashes, small extracted executables/readme, and import report:
`scratch/alice-preflight-20261009/`. Original archive transfer to temporary
`bx_75agndxm:/tmp/alice-original.exe` completed at 04:27:39Z with matching SHA256;
`transfer.json` is the completion receipt. The first extraction attempt could
not start because this no-env box has no `7z`; its failure log is preserved.
Using installed `unzip`, all 15 files were extracted to
`/home/user/alice-original-v2-20261009`, with exact expected total size and
successful archive CRC test. Preparation PID251100 finished at 04:28:27Z.
All 13 PE modules were audited; only the five MIDI imports above were reported.
Exact file hashes, CRC output and full audit are the local `remote-v2-*` receipts.

Original code registers `in_midi` with default string `0` at `0046acf0`.
Initialization at `0046b460` reads it, compares with zero, and returns via
`0046b51d` before `midiInGetNumDevs` when zero. This supports optional MIDI
startup as a static inference; no handler or config was changed, and runtime
reachability is still unverified. See `midi-static-route.json`.

Prepared `/tmp/alice-probe-launch.js` refuses to run while BW2 browser189048
or Disciples handoff controller234050 is alive. It has a 180-second outer guard,
mounts original `demo/**/*`, `snddrivers/**/*`, and `readme.txt`, and captures
the first visible window without inputs. It is uploaded and syntax checked,
not executed. No missing archive paths are known. Next: ordinary launch after
the serialized current work, then New Game/skill selection and W/S movement
as described by the original readme. Do not start a parallel guest or browser.
