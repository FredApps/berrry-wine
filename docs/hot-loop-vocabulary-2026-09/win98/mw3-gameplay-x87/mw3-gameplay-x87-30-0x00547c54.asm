; mw3-gameplay-x87-30-0x00547c54
; runtime 0x00547c54  module mech3demo.exe  orig 0x00547c54
; entries 80514  guest ops 8  retired 644112  0.59% of window

00547c54  8b 44 24 30                  mov eax, [esp+0x30]
00547c58  d9 05 b4 90 59 00            fld dword [0x5990b4]
00547c5e  d8 20                        fsub dword [eax]
00547c60  d8 0d c0 90 59 00            fmul dword [0x5990c0]
00547c66  d9 43 fc                     fld dword [ebx-0x4]
00547c69  d8 c9                        fmul st, st(1)
00547c6b  d8 25 d4 90 59 00            fsub dword [0x5990d4]
00547c71  e8 2a fa 02 00               call 0x5776a0
