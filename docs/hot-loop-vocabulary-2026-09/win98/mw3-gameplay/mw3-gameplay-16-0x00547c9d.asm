; mw3-gameplay-16-0x00547c9d
; runtime 0x00547c9d  module mech3demo.exe  orig 0x00547c9d
; entries 124271  guest ops 13  retired 1615523  0.86% of window

00547c9d  8b 54 24 14                  mov edx, [esp+0x14]
00547ca1  0b e8                        or ebp, eax
00547ca3  8b 44 24 34                  mov eax, [esp+0x34]
00547ca7  0b ea                        or ebp, edx
00547ca9  83 c3 0c                     add dword ebx, 0xc
00547cac  89 68 10                     mov [eax+0x10], ebp
00547caf  8b 6c 24 30                  mov ebp, [esp+0x30]
00547cb3  83 e8 20                     sub dword eax, 0x20
00547cb6  83 c5 04                     add dword ebp, 0x4
00547cb9  3d dc 76 7c 00               cmp eax, 0x7c76dc
00547cbe  89 44 24 34                  mov [esp+0x34], eax
00547cc2  89 6c 24 30                  mov [esp+0x30], ebp
00547cc6  73 8c                        jnb short 0x547c54
