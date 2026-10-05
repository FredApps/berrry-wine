; quake2-gameplay-x87-110-0x00d890c0
; runtime 0x00d890c0  module ref_soft.dll  orig 0x1000b0c0
; entries 7419  guest ops 47  retired 348693  0.18% of window

1000b0c0  89 2d 40 e2 02 10            mov [0x1002e240], ebp
1000b0c6  56                           push esi
1000b0c7  57                           push edi
1000b0c8  8b 35 30 e2 02 10            mov esi, [0x1002e230]
1000b0ce  d9 06                        fld dword [esi]
1000b0d0  d8 25 a0 b9 0f 10            fsub dword [0x100fb9a0]
1000b0d6  d9 46 04                     fld dword [esi+0x4]
1000b0d9  d8 25 a4 b9 0f 10            fsub dword [0x100fb9a4]
1000b0df  d9 46 08                     fld dword [esi+0x8]
1000b0e2  d8 25 a8 b9 0f 10            fsub dword [0x100fb9a8]
1000b0e8  d9 ca                        fxch st(2)
1000b0ea  d9 1d 48 e2 02 10            fstp dword [0x1002e248]
1000b0f0  d9 1d 4c e2 02 10            fstp dword [0x1002e24c]
1000b0f6  d9 1d 50 e2 02 10            fstp dword [0x1002e250]
1000b0fc  d9 05 48 e2 02 10            fld dword [0x1002e248]
1000b102  d8 0d 60 59 03 10            fmul dword [0x10035960]
1000b108  d9 05 4c e2 02 10            fld dword [0x1002e24c]
1000b10e  d8 0d 64 59 03 10            fmul dword [0x10035964]
1000b114  d9 05 50 e2 02 10            fld dword [0x1002e250]
1000b11a  d8 0d 68 59 03 10            fmul dword [0x10035968]
1000b120  d9 ca                        fxch st(2)
1000b122  de c1                        faddp st(1), st
1000b124  de c1                        faddp st(1), st
1000b126  d9 1d 58 e2 02 10            fstp dword [0x1002e258]
1000b12c  d9 05 48 e2 02 10            fld dword [0x1002e248]
1000b132  d8 0d 80 59 03 10            fmul dword [0x10035980]
1000b138  d9 05 4c e2 02 10            fld dword [0x1002e24c]
1000b13e  d8 0d 84 59 03 10            fmul dword [0x10035984]
1000b144  d9 05 50 e2 02 10            fld dword [0x1002e250]
1000b14a  d8 0d 88 59 03 10            fmul dword [0x10035988]
1000b150  d9 ca                        fxch st(2)
1000b152  de c1                        faddp st(1), st
1000b154  de c1                        faddp st(1), st
1000b156  d9 1d 5c e2 02 10            fstp dword [0x1002e25c]
1000b15c  d9 05 48 e2 02 10            fld dword [0x1002e248]
1000b162  d8 0d 70 59 03 10            fmul dword [0x10035970]
1000b168  d9 05 4c e2 02 10            fld dword [0x1002e24c]
1000b16e  d8 0d 74 59 03 10            fmul dword [0x10035974]
1000b174  d9 05 50 e2 02 10            fld dword [0x1002e250]
1000b17a  d8 0d 78 59 03 10            fmul dword [0x10035978]
1000b180  d9 ca                        fxch st(2)
1000b182  de c1                        faddp st(1), st
1000b184  de c1                        faddp st(1), st
1000b186  d9 1d 60 e2 02 10            fstp dword [0x1002e260]
1000b18c  a1 60 e2 02 10               mov eax, [0x1002e260]
1000b191  23 c0                        and eax, eax
1000b193  0f 88 8b 01 00 00            js 0x1000b324
