# WinBoard4.2.7 — local original GNU Chess route

Local app `winboard` is prepared from the exact `winboard-installer` corpus package. Installer SHA1ffb4527ade3380973b5e68d9f7cfacc0c348a0b0 matches existing manifest; SHA256697c584d21a87c9851a83e763ceff38d03e1916e1b0bda4ae5558dc8c92dd852. Static ZIP then InstallShield old-compression extraction produces27 original files/8654233bytes. Hashes and original URL are in lib/winboard-source.json. No Windows installer execution or gameplay acceptance is implied.

`tools/prepare-winboard-assets.js --payload=DIR` verifies the exact extracted27-file group and prepares ignored fixture assets/manifest. Source extraction: 7z original SFX; unshield -O -g "Program Executable Files" x data1.cab. Normal compression reports zlib -3 for this old cabinet, while -O succeeds; retain original bytes.

Original GUI1,996,284B and GNUChess4.0.80 engine205,824B use normal -cp -fcp GNUChess -scp GNUChess options. Both run in C:\ with gnuchess.lan, gnuchess.dat and book.dat present. Bundled GNUChess5.07 and its three Cygwin DLLs are retained, but are not this initial route. Frontend requires original msvcrt.dll; other frontend imports use emulated system DLLs. GNUChess4 imports KERNEL32 only.

Actual process/pipe acceptance remains to be done: frontend imports CreatePipe, DuplicateHandle, CreateProcessA, CreateThread, ReadFile, WriteFile and CloseHandle; engine reads inherited GetStdHandle/SetStdHandle handles. Ordinary qualification must review initial board, perform legal human move e2-e4 and observe original engine reply, with exact source/asset and cleanup receipts. Never replace this with a synthetic board or injected protocol response. No current gameplay/FPS claim.
