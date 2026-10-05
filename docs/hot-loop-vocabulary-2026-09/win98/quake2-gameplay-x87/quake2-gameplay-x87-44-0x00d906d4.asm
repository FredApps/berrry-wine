; quake2-gameplay-x87-44-0x00d906d4
; runtime 0x00d906d4  module ref_soft.dll  orig 0x100126d4
; entries 32346  guest ops 29  retired 938034  0.48% of window

100126d4  d9 06                        fld dword [esi]
100126d6  d8 0b                        fmul dword [ebx]
100126d8  d9 46 04                     fld dword [esi+0x4]
100126db  d8 4b 04                     fmul dword [ebx+0x4]
100126de  d9 46 08                     fld dword [esi+0x8]
100126e1  d8 4b 08                     fmul dword [ebx+0x8]
100126e4  d9 c9                        fxch st(1)
100126e6  de c2                        faddp st(2), st
100126e8  d9 02                        fld dword [edx]
100126ea  d8 0b                        fmul dword [ebx]
100126ec  d9 42 04                     fld dword [edx+0x4]
100126ef  d8 4b 04                     fmul dword [ebx+0x4]
100126f2  d9 42 08                     fld dword [edx+0x8]
100126f5  d8 4b 08                     fmul dword [ebx+0x8]
100126f8  d9 c9                        fxch st(1)
100126fa  de c2                        faddp st(2), st
100126fc  d9 cb                        fxch st(3)
100126fe  de c2                        faddp st(2), st
10012700  de c2                        faddp st(2), st
10012702  d8 63 0c                     fsub dword [ebx+0xc]
10012705  d9 c9                        fxch st(1)
10012707  d8 63 0c                     fsub dword [ebx+0xc]
1001270a  d9 c9                        fxch st(1)
1001270c  d9 1d 64 79 02 10            fstp dword [0x10027964]
10012712  d9 1d 68 79 02 10            fstp dword [0x10027968]
10012718  a1 64 79 02 10               mov eax, [0x10027964]
1001271d  8b 0d 68 79 02 10            mov ecx, [0x10027968]
10012723  0b c8                        or ecx, eax
10012725  0f 88 51 02 00 00            js 0x1001297c
