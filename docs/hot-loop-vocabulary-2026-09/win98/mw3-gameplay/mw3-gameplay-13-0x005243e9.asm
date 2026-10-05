; mw3-gameplay-13-0x005243e9
; runtime 0x005243e9  module mech3demo.exe  orig 0x005243e9
; entries 133725  guest ops 13  retired 1738425  0.93% of window

005243e9  8b 45 f8                     mov eax, [ebp-0x8]
005243ec  d1 f8                        sar eax, 1
005243ee  05 00 00 c0 1f               add eax, 0x1fc00000
005243f3  89 45 f4                     mov [ebp-0xc], eax
005243f6  d9 45 f4                     fld dword [ebp-0xc]
005243f9  d8 25 84 6b 70 00            fsub dword [0x706b84]
005243ff  d8 0d 94 6b 70 00            fmul dword [0x706b94]
00524405  d9 11                        fst dword [ecx]
00524407  d9 45 fc                     fld dword [ebp-0x4]
0052440a  d8 1d 9c 6b 70 00            fcomp dword [0x706b9c]
00524410  df e0                        fnstsw ax
00524412  f6 c4 41                     test ah, 0x41
00524415  75 13                        jnz short 0x52442a
