; mw3-gameplay-12-0x0051bf10
; runtime 0x0051bf10  module mech3demo.exe  orig 0x0051bf10
; entries 164196  guest ops 11  retired 1806156  0.96% of window

0051bf10  83 ec 08                     sub dword esp, 0x8
0051bf13  d9 44 24 0c                  fld dword [esp+0xc]
0051bf17  d8 0d f0 89 59 00            fmul dword [0x5989f0]
0051bf1d  dc 25 f8 89 59 00            fsub qword [0x5989f8]
0051bf23  dd 5c 24 00                  fstp qword [esp+0x0]
0051bf27  8b 44 24 00                  mov eax, [esp+0x0]
0051bf2b  8b c8                        mov ecx, eax
0051bf2d  83 e0 3f                     and dword eax, 0x3f
0051bf30  83 e1 40                     and dword ecx, 0x40
0051bf33  83 f8 20                     cmp dword eax, 0x20
0051bf36  76 09                        jbe short 0x51bf41
