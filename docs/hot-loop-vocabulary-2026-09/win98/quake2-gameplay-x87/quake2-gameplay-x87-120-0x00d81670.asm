; quake2-gameplay-x87-120-0x00d81670
; runtime 0x00d81670  module ref_soft.dll  orig 0x10003670
; entries 5211  guest ops 64  retired 333504  0.17% of window
; TRUNCATED at --max-ops: no terminator within the window

10003670  83 ec 1c                     sub dword esp, 0x1c
10003673  8b 44 24 24                  mov eax, [esp+0x24]
10003677  33 d2                        xor edx, edx
10003679  d9 05 b4 85 11 10            fld dword [0x101185b4]
1000367f  d9 05 b8 85 11 10            fld dword [0x101185b8]
10003685  89 15 fc c1 02 10            mov [0x1002c1fc], edx
1000368b  8b 40 18                     mov eax, [eax+0x18]
1000368e  8b 4c 24 20                  mov ecx, [esp+0x20]
10003692  53                           push ebx
10003693  d8 48 08                     fmul dword [eax+0x8]
10003696  d9 00                        fld dword [eax]
10003698  d9 ca                        fxch st(2)
1000369a  d8 48 04                     fmul dword [eax+0x4]
1000369d  d9 05 84 85 11 10            fld dword [0x10118584]
100036a3  d9 05 88 85 11 10            fld dword [0x10118588]
100036a9  d9 05 90 85 11 10            fld dword [0x10118590]
100036af  d9 cb                        fxch st(3)
100036b1  de c4                        faddp st(4), st
100036b3  d9 05 94 85 11 10            fld dword [0x10118594]
100036b9  d9 cd                        fxch st(5)
100036bb  d8 0d b0 85 11 10            fmul dword [0x101185b0]
100036c1  55                           push ebp
100036c2  56                           push esi
100036c3  3b ca                        cmp ecx, edx
100036c5  57                           push edi
100036c6  de c4                        faddp st(4), st
100036c8  d9 c9                        fxch st(1)
100036ca  d8 48 04                     fmul dword [eax+0x4]
100036cd  d9 05 80 85 11 10            fld dword [0x10118580]
100036d3  d9 cc                        fxch st(4)
100036d5  d8 68 0c                     fsubr dword [eax+0xc]
100036d8  89 54 24 14                  mov [esp+0x14], edx
100036dc  89 54 24 10                  mov [esp+0x10], edx
100036e0  d9 5c 24 24                  fstp dword [esp+0x24]
100036e4  d9 05 9c 85 11 10            fld dword [0x1011859c]
100036ea  d9 ca                        fxch st(2)
100036ec  d8 48 08                     fmul dword [eax+0x8]
100036ef  bd 02 00 00 00               mov ebp, 0x2
100036f4  de c1                        faddp st(1), st
100036f6  d9 05 a0 85 11 10            fld dword [0x101185a0]
100036fc  d9 cc                        fxch st(4)
100036fe  d8 08                        fmul dword [eax]
10003700  de c1                        faddp st(1), st
10003702  d9 ca                        fxch st(2)
10003704  d8 48 04                     fmul dword [eax+0x4]
10003707  d9 05 8c 85 11 10            fld dword [0x1011858c]
1000370d  d9 cb                        fxch st(3)
1000370f  d9 5c 24 18                  fstp dword [esp+0x18]
10003713  d9 cc                        fxch st(4)
10003715  d8 48 08                     fmul dword [eax+0x8]
10003718  d9 05 98 85 11 10            fld dword [0x10118598]
1000371e  d9 c9                        fxch st(1)
10003720  de c5                        faddp st(5), st
10003722  d9 c9                        fxch st(1)
10003724  d8 48 04                     fmul dword [eax+0x4]
10003727  d9 cb                        fxch st(3)
10003729  d8 48 08                     fmul dword [eax+0x8]
1000372c  d9 ca                        fxch st(2)
1000372e  d8 08                        fmul dword [eax]
10003730  d9 ca                        fxch st(2)
10003732  de c3                        faddp st(3), st
10003734  d8 08                        fmul dword [eax]
10003736  d9 c9                        fxch st(1)
10003738  de c3                        faddp st(3), st
