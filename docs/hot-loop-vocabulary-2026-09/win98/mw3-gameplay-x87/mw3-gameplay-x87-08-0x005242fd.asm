; mw3-gameplay-x87-08-0x005242fd
; runtime 0x005242fd  module mech3demo.exe  orig 0x005242fd
; entries 98670  guest ops 15  retired 1480050  1.35% of window

005242fd  d9 46 04                     fld dword [esi+0x4]
00524300  d9 46 fc                     fld dword [esi-0x4]
00524303  d9 c1                        fld st(1)
00524305  d8 ca                        fmul st, st(2)
00524307  d9 c1                        fld st(1)
00524309  d8 ca                        fmul st, st(2)
0052430b  de c1                        faddp st(1), st
0052430d  d9 5d f8                     fstp dword [ebp-0x8]
00524310  dd d8                        fstp st(0)
00524312  dd d8                        fstp st(0)
00524314  d9 45 f8                     fld dword [ebp-0x8]
00524317  d8 1d 88 6b 70 00            fcomp dword [0x706b88]
0052431d  df e0                        fnstsw ax
0052431f  f6 c4 41                     test ah, 0x41
00524322  74 0b                        jz short 0x52432f
