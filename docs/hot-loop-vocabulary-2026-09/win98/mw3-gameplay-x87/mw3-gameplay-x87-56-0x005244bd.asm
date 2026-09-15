; mw3-gameplay-x87-56-0x005244bd
; runtime 0x005244bd  module mech3demo.exe  orig 0x005244bd
; entries 25914  guest ops 14  retired 362796  0.33% of window

005244bd  d9 05 78 6b 70 00            fld dword [0x706b78]
005244c3  d8 0d c0 8a 59 00            fmul dword [0x598ac0]
005244c9  d9 1d 3c e8 6e 00            fstp dword [0x6ee83c]
005244cf  d9 05 7c 6b 70 00            fld dword [0x706b7c]
005244d5  d8 0d c0 8a 59 00            fmul dword [0x598ac0]
005244db  d9 1d 40 e8 6e 00            fstp dword [0x6ee840]
005244e1  d9 05 80 6b 70 00            fld dword [0x706b80]
005244e7  d8 0d c0 8a 59 00            fmul dword [0x598ac0]
005244ed  d9 1d 44 e8 6e 00            fstp dword [0x6ee844]
005244f3  d9 05 48 e8 6e 00            fld dword [0x6ee848]
005244f9  d8 1d 3c e8 6e 00            fcomp dword [0x6ee83c]
005244ff  df e0                        fnstsw ax
00524501  f6 c4 40                     test ah, 0x40
00524504  74 26                        jz short 0x52452c
