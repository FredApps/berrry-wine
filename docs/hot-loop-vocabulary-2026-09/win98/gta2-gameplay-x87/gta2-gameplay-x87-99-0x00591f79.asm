; gta2-gameplay-x87-99-0x00591f79
; runtime 0x00591f79  module gta2.exe  orig 0x00591f79
; entries 268  guest ops 57  retired 15276  0.16% of window

00591f79  b9 08 00 00 00               mov ecx, 0x8
00591f7e  be 28 34 6f 00               mov esi, 0x6f3428
00591f83  8d 7c 24 40                  lea edi, [esp+0x40]
00591f87  68 ff 00 00 00               push 0xff
00591f8c  f3 a5                        rep movsd
00591f8e  b9 08 00 00 00               mov ecx, 0x8
00591f93  be 48 34 6f 00               mov esi, 0x6f3448
00591f98  8d 7c 24 64                  lea edi, [esp+0x64]
00591f9c  f3 a5                        rep movsd
00591f9e  b9 08 00 00 00               mov ecx, 0x8
00591fa3  be 68 34 6f 00               mov esi, 0x6f3468
00591fa8  8d bc 24 84 00 00 00         lea edi, [esp+0x84]
00591faf  f3 a5                        rep movsd
00591fb1  b9 08 00 00 00               mov ecx, 0x8
00591fb6  be 88 34 6f 00               mov esi, 0x6f3488
00591fbb  8d bc 24 a4 00 00 00         lea edi, [esp+0xa4]
00591fc2  f3 a5                        rep movsd
00591fc4  8b 0d 28 69 66 00            mov ecx, [0x666928]
00591fca  8b 81 a8 00 00 00            mov eax, [ecx+0xa8]
00591fd0  8b 4c 24 3c                  mov ecx, [esp+0x3c]
00591fd4  8d 14 80                     lea edx, [eax+eax*4]
00591fd7  b8 00 00 00 a0               mov eax, 0xa0000000
00591fdc  89 54 24 1c                  mov [esp+0x1c], edx
00591fe0  89 44 24 54                  mov [esp+0x54], eax
00591fe4  db 44 24 1c                  fild dword [esp+0x1c]
00591fe8  89 44 24 74                  mov [esp+0x74], eax
00591fec  89 84 24 94 00 00 00         mov [esp+0x94], eax
00591ff3  89 84 24 b4 00 00 00         mov [esp+0xb4], eax
00591ffa  8d 44 24 44                  lea eax, [esp+0x44]
00591ffe  d8 0d e0 0b 5f 00            fmul dword [0x5f0be0]
00592004  50                           push eax
00592005  51                           push ecx
00592006  68 80 21 00 00               push 0x2180
0059200b  d9 c0                        fld st(0)
0059200d  d8 05 28 34 6f 00            fadd dword [0x6f3428]
00592013  d9 5c 24 50                  fstp dword [esp+0x50]
00592017  d9 c0                        fld st(0)
00592019  d8 05 48 34 6f 00            fadd dword [0x6f3448]
0059201f  d9 5c 24 70                  fstp dword [esp+0x70]
00592023  d9 c0                        fld st(0)
00592025  d8 05 68 34 6f 00            fadd dword [0x6f3468]
0059202b  d9 9c 24 90 00 00 00         fstp dword [esp+0x90]
00592032  d9 c0                        fld st(0)
00592034  d8 05 88 34 6f 00            fadd dword [0x6f3488]
0059203a  d9 9c 24 b0 00 00 00         fstp dword [esp+0xb0]
00592041  d9 c0                        fld st(0)
00592043  d8 44 24 54                  fadd dword [esp+0x54]
00592047  d9 5c 24 54                  fstp dword [esp+0x54]
0059204b  d9 c0                        fld st(0)
0059204d  d8 44 24 74                  fadd dword [esp+0x74]
00592051  d9 5c 24 74                  fstp dword [esp+0x74]
00592055  d9 c0                        fld st(0)
00592057  d8 84 24 94 00 00 00         fadd dword [esp+0x94]
0059205e  d9 9c 24 94 00 00 00         fstp dword [esp+0x94]
00592065  d8 84 24 b4 00 00 00         fadd dword [esp+0xb4]
0059206c  d9 9c 24 b4 00 00 00         fstp dword [esp+0xb4]
00592073  ff 15 c0 59 61 00            call [0x6159c0]
