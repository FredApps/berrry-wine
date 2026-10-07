# WinBoard4.2.7 — local original GNU Chess route

Local app `winboard` is prepared from the exact `winboard-installer` corpus package. Installer SHA1ffb4527ade3380973b5e68d9f7cfacc0c348a0b0 matches existing manifest; SHA256697c584d21a87c9851a83e763ceff38d03e1916e1b0bda4ae5558dc8c92dd852. Static ZIP then InstallShield old-compression extraction produces27 original files/8654233bytes. Hashes and original URL are in lib/winboard-source.json. No Windows installer execution or gameplay acceptance is implied.

`tools/prepare-winboard-assets.js --payload=DIR` verifies the exact extracted27-file group and prepares ignored fixture assets/manifest. Source extraction: 7z original SFX; unshield -O -g "Program Executable Files" x data1.cab. Normal compression reports zlib -3 for this old cabinet, while -O succeeds; retain original bytes.

Original GUI1,996,284B and GNUChess4.0.80 engine205,824B use normal -cp -fcp GNUChess -scp GNUChess options. Both run in C:\ with gnuchess.lan, gnuchess.dat and book.dat present. Bundled GNUChess5.07 and its three Cygwin DLLs are retained, but are not this initial route. Frontend requires original msvcrt.dll; other frontend imports use emulated system DLLs. GNUChess4 imports KERNEL32 only.

Actual process/pipe acceptance remains to be done: frontend imports CreatePipe, DuplicateHandle, CreateProcessA, CreateThread, ReadFile, WriteFile and CloseHandle; engine reads inherited GetStdHandle/SetStdHandle handles. Ordinary qualification must review initial board, perform legal human move e2-e4 and observe original engine reply, with exact source/asset and cleanup receipts. Never replace this with a synthetic board or injected protocol response. No current gameplay/FPS claim.

## 2026-10-05 ordinary engine startup: blocked

The original 27-file payload was mounted and the normal `-cp -fcp GNUChess -scp GNUChess` route launched on production-shaped module ad94407c (runtime b9155c8c, registration 9fc73eb3). Session10947 stopped cleanly at17:41:32.387Z. Actual guest trap: unimplemented CreatePipe at0x4496a0, caller0x412d36, output pointers0x074ffbe4/0x074ffbe0, SECURITY_ATTRIBUTES0x074ffbc0, size0. No visible chessboard, move, engine reply or FPS was qualified. Harness exit0 denotes cleanup, not guest success. Evidence: `scratch/runs/20261005-winboard-engine-startup/result.json` and immutable hash manifest `validation.json`.

Source audit against main a15d5e46 confirms CreatePipe and PeekNamedPipe are crash stubs (src/09a0b-handlers-base-late.wat). CreateProcessA there launches through host_shell_execute with no STARTUPINFO standard-handle transport or inheritance processing, then returns fixed process/thread identities. DuplicateHandle handles console/file cases, not a real anonymous-pipe endpoint namespace. The source-known prerequisite is broader than the first observed trap; no claim is made that these later APIs were reached.

Prerequisite PROCESS-PIPE-STDIO-WINBOARD: implement real anonymous pipe endpoints, ordered byte transfer, blocking/wakeup, partial reads, EOF/broken-pipe and endpoint refcounts; integrate ReadFile/WriteFile/CloseHandle/GetFileType/DuplicateHandle, inheritance flags and genuine child launch STARTUPINFO std handles/process lifetime. Validate cross-process parent/child roundtrip and closure in both supported thread backends, sparse output/error/ABI contracts, then normal WinBoard human move and authentic GNUChess reply. Do not substitute protocol answers, remove GNUChess, or return success for missing transport. This architectural prerequisite is separate from game screenshot coverage.

## October 6 follow-up: real engine play and browser repaint

The blocked October 5 observation above is historical. Pipe endpoints and
child stdio/process support subsequently landed. Retained CLI evidence at
`scratch/runs/20261006T0820Z-winboard-move2/result.json` records ordinary
`1.e4` and an authentic GNUChess reply. The later Threads-on browser route
(`scratch/runs/20261006T1420Z-winboard-web-threads/result.json`) shows
`1.e4 e6`; its `board.png` has an empty e2 square, the white pawn on e4 and
Black's last-move highlight on e7/e6. The child is the original GNUChess
process with piped standard handles, not an injected engine response.

Commit `2dab96f8` fixes the remaining cross-Worker SendMessage/repaint wait.
The retained screenshot and result were reviewed again on October 7. No new
run or FPS measurement was performed during that reconciliation.
