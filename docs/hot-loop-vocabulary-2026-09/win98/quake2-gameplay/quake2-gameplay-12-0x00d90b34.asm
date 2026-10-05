; quake2-gameplay-12-0x00d90b34
; runtime 0x00d90b34  module ref_soft.dll  orig 0x10012b34
; entries 842764  guest ops 40  retired 33710560  1.13% of window

10012b34  d9 06                        fld dword [esi]
10012b36  d8 25 70 85 11 10            fsub dword [0x10118570]
10012b3c  d9 46 04                     fld dword [esi+0x4]
10012b3f  d8 25 74 85 11 10            fsub dword [0x10118574]
10012b45  d9 46 08                     fld dword [esi+0x8]
10012b48  d8 25 78 85 11 10            fsub dword [0x10118578]
10012b4e  d9 ca                        fxch st(2)
10012b50  d9 c0                        fld st(0)
10012b52  d8 0d c0 86 0e 10            fmul dword [0x100e86c0]
10012b58  d9 c1                        fld st(1)
10012b5a  d8 0d b0 b9 0f 10            fmul dword [0x100fb9b0]
10012b60  d9 ca                        fxch st(2)
10012b62  d8 0d e0 86 0e 10            fmul dword [0x100e86e0]
10012b68  d9 c3                        fld st(3)
10012b6a  d8 0d c4 86 0e 10            fmul dword [0x100e86c4]
10012b70  d9 c4                        fld st(4)
10012b72  d8 0d b4 b9 0f 10            fmul dword [0x100fb9b4]
10012b78  d9 cd                        fxch st(5)
10012b7a  d8 0d e4 86 0e 10            fmul dword [0x100e86e4]
10012b80  d9 c9                        fxch st(1)
10012b82  de c3                        faddp st(3), st
10012b84  d9 cb                        fxch st(3)
10012b86  de c4                        faddp st(4), st
10012b88  de c2                        faddp st(2), st
10012b8a  d9 c3                        fld st(3)
10012b8c  d8 0d c8 86 0e 10            fmul dword [0x100e86c8]
10012b92  d9 c4                        fld st(4)
10012b94  d8 0d b8 b9 0f 10            fmul dword [0x100fb9b8]
10012b9a  d9 cd                        fxch st(5)
10012b9c  d8 0d e8 86 0e 10            fmul dword [0x100e86e8]
10012ba2  d9 c9                        fxch st(1)
10012ba4  de c2                        faddp st(2), st
10012ba6  d9 cc                        fxch st(4)
10012ba8  de c3                        faddp st(3), st
10012baa  d9 c9                        fxch st(1)
10012bac  de c3                        faddp st(3), st
10012bae  d8 15 70 79 02 10            fcom dword [0x10027970]
10012bb4  df e0                        fnstsw ax
10012bb6  f6 c4 01                     test ah, 0x1
10012bb9  74 08                        jz short 0x10012bc3
