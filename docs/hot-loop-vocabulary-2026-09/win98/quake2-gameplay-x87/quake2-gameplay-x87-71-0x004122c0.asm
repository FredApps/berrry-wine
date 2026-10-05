; quake2-gameplay-x87-71-0x004122c0
; runtime 0x004122c0  module quake2.exe  orig 0x004122c0
; entries 13626  guest ops 35  retired 476910  0.24% of window

004122c0  8b 44 24 50                  mov eax, [esp+0x50]
004122c4  8b 4c 24 4c                  mov ecx, [esp+0x4c]
004122c8  d9 40 08                     fld dword [eax+0x8]
004122cb  d9 40 04                     fld dword [eax+0x4]
004122ce  d8 4a 04                     fmul dword [edx+0x4]
004122d1  d9 02                        fld dword [edx]
004122d3  d9 ca                        fxch st(2)
004122d5  d8 4a 08                     fmul dword [edx+0x8]
004122d8  d9 41 08                     fld dword [ecx+0x8]
004122db  d9 cb                        fxch st(3)
004122dd  d8 08                        fmul dword [eax]
004122df  d9 c9                        fxch st(1)
004122e1  de c2                        faddp st(2), st
004122e3  d9 41 04                     fld dword [ecx+0x4]
004122e6  d9 cb                        fxch st(3)
004122e8  d8 4a 08                     fmul dword [edx+0x8]
004122eb  d9 c9                        fxch st(1)
004122ed  de c2                        faddp st(2), st
004122ef  d9 ca                        fxch st(2)
004122f1  d8 4a 04                     fmul dword [edx+0x4]
004122f4  d9 02                        fld dword [edx]
004122f6  d9 ca                        fxch st(2)
004122f8  d8 64 24 48                  fsub dword [esp+0x48]
004122fc  d9 ca                        fxch st(2)
004122fe  d8 09                        fmul dword [ecx]
00412300  d9 c9                        fxch st(1)
00412302  de c3                        faddp st(3), st
00412304  d9 c1                        fld st(1)
00412306  d8 1d f8 25 44 00            fcomp dword [0x4425f8]
0041230c  de c2                        faddp st(2), st
0041230e  d9 c9                        fxch st(1)
00412310  df e0                        fnstsw ax
00412312  d8 64 24 48                  fsub dword [esp+0x48]
00412316  f6 c4 41                     test ah, 0x41
00412319  75 08                        jnz short 0x412323
