; quake2-loading-25-0x00d87e4b
; runtime 0x00d87e4b  module ref_soft.dll  orig 0x10009e4b
; entries 75153  guest ops 17  retired 1277601  0.46% of window

10009e4b  d9 41 fc                     fld dword [ecx-0x4]
10009e4e  d9 41 f8                     fld dword [ecx-0x8]
10009e51  d8 0e                        fmul dword [esi]
10009e53  d9 01                        fld dword [ecx]
10009e55  d9 ca                        fxch st(2)
10009e57  d8 4e 04                     fmul dword [esi+0x4]
10009e5a  d9 ca                        fxch st(2)
10009e5c  d8 4e 08                     fmul dword [esi+0x8]
10009e5f  d9 ca                        fxch st(2)
10009e61  de c1                        faddp st(1), st
10009e63  d9 c9                        fxch st(1)
10009e65  de c1                        faddp st(1), st
10009e67  d8 41 04                     fadd dword [ecx+0x4]
10009e6a  d8 54 14 14                  fcom dword [esp+edx+0x14]
10009e6e  df e0                        fnstsw ax
10009e70  f6 c4 01                     test ah, 0x1
10009e73  74 04                        jz short 0x10009e79
