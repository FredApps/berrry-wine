; mw3-01-0x00540638
; runtime 0x00540638  module mech3demo.exe  orig 0x00540638
; entries 26637  guest ops 23  retired 612651  5.73% of window

00540638  89 44 24 00                  mov [esp+0x0], eax
0054063c  c7 44 24 04 00 00 00 00      mov dword [esp+0x4], 0x0
00540644  df 6c 24 00                  fild word [esp+0x0]
00540648  d9 05 90 c9 6e 00            fld dword [0x6ec990]
0054064e  d9 05 20 89 5b 00            fld dword [0x5b8920]
00540654  d9 ca                        fxch st(2)
00540656  d8 0d a8 8c 59 00            fmul dword [0x598ca8]
0054065c  a1 14 89 5b 00               mov eax, [0x5b8914]
00540661  c7 05 20 89 5b 00 00 00 80 3f mov dword [0x5b8920], 0x3f800000
0054066b  85 c0                        test eax, eax
0054066d  d9 15 1c 89 5b 00            fst dword [0x5b891c]
00540673  d9 c0                        fld st(0)
00540675  d8 25 18 89 5b 00            fsub dword [0x5b8918]
0054067b  d9 1d 8c c9 6e 00            fstp dword [0x6ec98c]
00540681  d9 c9                        fxch st(1)
00540683  d8 05 8c c9 6e 00            fadd dword [0x6ec98c]
00540689  d9 ca                        fxch st(2)
0054068b  d8 0d 8c c9 6e 00            fmul dword [0x6ec98c]
00540691  d9 ca                        fxch st(2)
00540693  d9 1d 90 c9 6e 00            fstp dword [0x6ec990]
00540699  d9 c9                        fxch st(1)
0054069b  d9 1d 84 c9 6e 00            fstp dword [0x6ec984]
005406a1  74 1d                        jz short 0x5406c0
