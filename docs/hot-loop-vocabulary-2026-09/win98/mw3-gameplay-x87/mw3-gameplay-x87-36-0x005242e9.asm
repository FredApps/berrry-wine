; mw3-gameplay-x87-36-0x005242e9
; runtime 0x005242e9  module mech3demo.exe  orig 0x005242e9
; entries 27110  guest ops 19  retired 515090  0.47% of window

005242e9  8d 04 52                     lea eax, [edx+edx*2]
005242ec  8d 0c 95 0c 5f 70 00         lea ecx, [0x705f0c+edx*4]
005242f3  8d 5a 01                     lea ebx, [edx+0x1]
005242f6  8d 34 85 e8 43 70 00         lea esi, [0x7043e8+eax*4]
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
