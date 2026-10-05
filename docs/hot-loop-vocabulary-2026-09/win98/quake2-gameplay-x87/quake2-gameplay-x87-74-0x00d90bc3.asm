; quake2-gameplay-x87-74-0x00d90bc3
; runtime 0x00d90bc3  module ref_soft.dll  orig 0x10012bc3
; entries 46062  guest ops 10  retired 460620  0.23% of window

10012bc3  d8 3d 44 7a 02 10            fdivr dword [0x10027a44]
10012bc9  d9 c9                        fxch st(1)
10012bcb  d9 05 fc 8c 0e 10            fld dword [0x100e8cfc]
10012bd1  d8 ca                        fmul st, st(2)
10012bd3  de c9                        fmulp st(1), st
10012bd5  d8 05 40 87 0e 10            fadd dword [0x100e8740]
10012bdb  d8 15 64 81 0e 10            fcom dword [0x100e8164]
10012be1  df e0                        fnstsw ax
10012be3  f6 c4 01                     test ah, 0x1
10012be6  74 08                        jz short 0x10012bf0
