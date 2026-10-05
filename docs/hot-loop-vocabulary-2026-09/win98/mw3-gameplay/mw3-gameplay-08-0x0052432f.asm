; mw3-gameplay-08-0x0052432f
; runtime 0x0052432f  module mech3demo.exe  orig 0x0052432f
; entries 159052  guest ops 14  retired 2226728  1.19% of window

0052432f  d9 05 50 d9 6f 00            fld dword [0x6fd950]
00524335  d8 0e                        fmul dword [esi]
00524337  d9 05 5c d9 6f 00            fld dword [0x6fd95c]
0052433d  d8 4e 04                     fmul dword [esi+0x4]
00524340  de c1                        faddp st(1), st
00524342  d9 05 44 d9 6f 00            fld dword [0x6fd944]
00524348  d8 4e fc                     fmul dword [esi-0x4]
0052434b  de c1                        faddp st(1), st
0052434d  d8 05 68 d9 6f 00            fadd dword [0x6fd968]
00524353  d9 55 fc                     fst dword [ebp-0x4]
00524356  d8 1d 98 6b 70 00            fcomp dword [0x706b98]
0052435c  df e0                        fnstsw ax
0052435e  f6 c4 01                     test ah, 0x1
00524361  75 0b                        jnz short 0x52436e
