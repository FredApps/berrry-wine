; mw3-gameplay-x87-28-0x005190cb
; runtime 0x005190cb  module mech3demo.exe  orig 0x005190cb
; entries 13800  guest ops 48  retired 662400  0.60% of window

005190cb  a1 50 6f 5b 00               mov eax, [0x5b6f50]
005190d0  89 7d f4                     mov [ebp-0xc], edi
005190d3  89 75 fc                     mov [ebp-0x4], esi
005190d6  83 c6 0c                     add dword esi, 0xc
005190d9  8b 10                        mov edx, [eax]
005190db  83 c7 0c                     add dword edi, 0xc
005190de  89 55 f8                     mov [ebp-0x8], edx
005190e1  8b 45 fc                     mov eax, [ebp-0x4]
005190e4  8b 5d f8                     mov ebx, [ebp-0x8]
005190e7  8b 55 f4                     mov edx, [ebp-0xc]
005190ea  d9 00                        fld dword [eax]
005190ec  d8 0b                        fmul dword [ebx]
005190ee  d9 00                        fld dword [eax]
005190f0  d8 4b 04                     fmul dword [ebx+0x4]
005190f3  d9 00                        fld dword [eax]
005190f5  d8 4b 08                     fmul dword [ebx+0x8]
005190f8  d9 40 04                     fld dword [eax+0x4]
005190fb  d8 4b 0c                     fmul dword [ebx+0xc]
005190fe  d9 40 04                     fld dword [eax+0x4]
00519101  d8 4b 10                     fmul dword [ebx+0x10]
00519104  d9 40 04                     fld dword [eax+0x4]
00519107  d8 4b 14                     fmul dword [ebx+0x14]
0051910a  d9 ca                        fxch st(2)
0051910c  de c5                        faddp st(5), st
0051910e  de c3                        faddp st(3), st
00519110  de c1                        faddp st(1), st
00519112  d9 40 08                     fld dword [eax+0x8]
00519115  d8 4b 18                     fmul dword [ebx+0x18]
00519118  d9 40 08                     fld dword [eax+0x8]
0051911b  d8 4b 1c                     fmul dword [ebx+0x1c]
0051911e  d9 40 08                     fld dword [eax+0x8]
00519121  d8 4b 20                     fmul dword [ebx+0x20]
00519124  d9 ca                        fxch st(2)
00519126  de c5                        faddp st(5), st
00519128  de c3                        faddp st(3), st
0051912a  de c1                        faddp st(1), st
0051912c  d9 ca                        fxch st(2)
0051912e  d8 43 24                     fadd dword [ebx+0x24]
00519131  d9 c9                        fxch st(1)
00519133  d8 43 28                     fadd dword [ebx+0x28]
00519136  d9 ca                        fxch st(2)
00519138  d8 43 2c                     fadd dword [ebx+0x2c]
0051913b  d9 c9                        fxch st(1)
0051913d  d9 1a                        fstp dword [edx]
0051913f  d9 5a 08                     fstp dword [edx+0x8]
00519142  d9 5a 04                     fstp dword [edx+0x4]
00519145  49                           dec ecx
00519146  75 83                        jnz short 0x5190cb
