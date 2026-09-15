; mw3-gameplay-25-0x0051bc31
; runtime 0x0051bc31  module mech3demo.exe  orig 0x0051bc31
; entries 165066  guest ops 7  retired 1155462  0.62% of window

0051bc31  d9 41 fc                     fld dword [ecx-0x4]
0051bc34  83 e9 04                     sub dword ecx, 0x4
0051bc37  4a                           dec edx
0051bc38  d8 1d d4 89 59 00            fcomp dword [0x5989d4]
0051bc3e  df e0                        fnstsw ax
0051bc40  f6 c4 41                     test ah, 0x41
0051bc43  75 08                        jnz short 0x51bc4d
