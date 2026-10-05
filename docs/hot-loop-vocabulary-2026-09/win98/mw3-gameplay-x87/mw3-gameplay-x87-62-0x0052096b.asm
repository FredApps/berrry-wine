; mw3-gameplay-x87-62-0x0052096b
; runtime 0x0052096b  module mech3demo.exe  orig 0x0052096b
; entries 24054  guest ops 14  retired 336756  0.31% of window

0052096b  d9 42 08                     fld dword [edx+0x8]
0052096e  d9 02                        fld dword [edx]
00520970  d8 24 0f                     fsub dword [edi+ecx]
00520973  d9 c9                        fxch st(1)
00520975  d8 64 0f 08                  fsub dword [edi+ecx+0x8]
00520979  d9 c9                        fxch st(1)
0052097b  d8 4c 24 2c                  fmul dword [esp+0x2c]
0052097f  d9 c9                        fxch st(1)
00520981  d8 4c 24 34                  fmul dword [esp+0x34]
00520985  de c1                        faddp st(1), st
00520987  dc 1d 88 8a 59 00            fcomp qword [0x598a88]
0052098d  df e0                        fnstsw ax
0052098f  f6 c4 41                     test ah, 0x41
00520992  75 07                        jnz short 0x52099b
