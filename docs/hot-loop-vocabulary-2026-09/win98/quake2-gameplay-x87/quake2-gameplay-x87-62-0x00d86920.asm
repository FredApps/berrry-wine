; quake2-gameplay-x87-62-0x00d86920
; runtime 0x00d86920  module ref_soft.dll  orig 0x10008920
; entries 18970  guest ops 32  retired 607040  0.31% of window

10008920  8b 44 24 04                  mov eax, [esp+0x4]
10008924  8b 54 24 08                  mov edx, [esp+0x8]
10008928  d9 00                        fld dword [eax]
1000892a  d8 0d b0 b9 0f 10            fmul dword [0x100fb9b0]
10008930  d9 00                        fld dword [eax]
10008932  d8 0d e0 86 0e 10            fmul dword [0x100e86e0]
10008938  d9 00                        fld dword [eax]
1000893a  d8 0d c0 86 0e 10            fmul dword [0x100e86c0]
10008940  d9 40 04                     fld dword [eax+0x4]
10008943  d8 0d b4 b9 0f 10            fmul dword [0x100fb9b4]
10008949  d9 40 04                     fld dword [eax+0x4]
1000894c  d8 0d e4 86 0e 10            fmul dword [0x100e86e4]
10008952  d9 40 04                     fld dword [eax+0x4]
10008955  d8 0d c4 86 0e 10            fmul dword [0x100e86c4]
1000895b  d9 ca                        fxch st(2)
1000895d  de c5                        faddp st(5), st
1000895f  de c3                        faddp st(3), st
10008961  de c1                        faddp st(1), st
10008963  d9 40 08                     fld dword [eax+0x8]
10008966  d8 0d b8 b9 0f 10            fmul dword [0x100fb9b8]
1000896c  d9 40 08                     fld dword [eax+0x8]
1000896f  d8 0d e8 86 0e 10            fmul dword [0x100e86e8]
10008975  d9 40 08                     fld dword [eax+0x8]
10008978  d8 0d c8 86 0e 10            fmul dword [0x100e86c8]
1000897e  d9 ca                        fxch st(2)
10008980  de c5                        faddp st(5), st
10008982  de c3                        faddp st(3), st
10008984  de c1                        faddp st(1), st
10008986  d9 5a 08                     fstp dword [edx+0x8]
10008989  d9 5a 04                     fstp dword [edx+0x4]
1000898c  d9 1a                        fstp dword [edx]
1000898e  c3                           ret
