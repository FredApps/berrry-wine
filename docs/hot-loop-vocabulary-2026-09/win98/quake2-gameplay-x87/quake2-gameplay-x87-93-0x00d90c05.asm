; quake2-gameplay-x87-93-0x00d90c05
; runtime 0x00d90c05  module ref_soft.dll  orig 0x10012c05
; entries 46062  guest ops 9  retired 414558  0.21% of window

10012c05  d9 c1                        fld st(1)
10012c07  d8 0d 00 b9 0f 10            fmul dword [0x100fb900]
10012c0d  de cb                        fmulp st(3), st
10012c0f  d9 ca                        fxch st(2)
10012c11  d8 2d 90 b9 0f 10            fsubr dword [0x100fb990]
10012c17  d8 15 68 81 0e 10            fcom dword [0x100e8168]
10012c1d  df e0                        fnstsw ax
10012c1f  f6 c4 01                     test ah, 0x1
10012c22  74 08                        jz short 0x10012c2c
