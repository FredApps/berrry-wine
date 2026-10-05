; mw3-gameplay-01-0x0051579f
; runtime 0x0051579f  module mech3demo.exe  orig 0x0051579f
; entries 134826  guest ops 48  retired 6471648  3.45% of window
; TRUNCATED at --max-ops: no terminator within the window

0051579f  8b 15 50 6f 5b 00            mov edx, [0x5b6f50]
005157a5  89 7d ac                     mov [ebp-0x54], edi
005157a8  89 75 b0                     mov [ebp-0x50], esi
005157ab  83 c6 0c                     add dword esi, 0xc
005157ae  8b 02                        mov eax, [edx]
005157b0  83 c7 0c                     add dword edi, 0xc
005157b3  89 45 a8                     mov [ebp-0x58], eax
005157b6  8b 45 b0                     mov eax, [ebp-0x50]
005157b9  8b 5d a8                     mov ebx, [ebp-0x58]
005157bc  8b 55 ac                     mov edx, [ebp-0x54]
005157bf  d9 00                        fld dword [eax]
005157c1  d8 0b                        fmul dword [ebx]
005157c3  d9 00                        fld dword [eax]
005157c5  d8 4b 04                     fmul dword [ebx+0x4]
005157c8  d9 00                        fld dword [eax]
005157ca  d8 4b 08                     fmul dword [ebx+0x8]
005157cd  d9 40 04                     fld dword [eax+0x4]
005157d0  d8 4b 0c                     fmul dword [ebx+0xc]
005157d3  d9 40 04                     fld dword [eax+0x4]
005157d6  d8 4b 10                     fmul dword [ebx+0x10]
005157d9  d9 40 04                     fld dword [eax+0x4]
005157dc  d8 4b 14                     fmul dword [ebx+0x14]
005157df  d9 ca                        fxch st(2)
005157e1  de c5                        faddp st(5), st
005157e3  de c3                        faddp st(3), st
005157e5  de c1                        faddp st(1), st
005157e7  d9 40 08                     fld dword [eax+0x8]
005157ea  d8 4b 18                     fmul dword [ebx+0x18]
005157ed  d9 40 08                     fld dword [eax+0x8]
005157f0  d8 4b 1c                     fmul dword [ebx+0x1c]
005157f3  d9 40 08                     fld dword [eax+0x8]
005157f6  d8 4b 20                     fmul dword [ebx+0x20]
005157f9  d9 ca                        fxch st(2)
005157fb  de c5                        faddp st(5), st
005157fd  de c3                        faddp st(3), st
005157ff  de c1                        faddp st(1), st
00515801  d9 ca                        fxch st(2)
00515803  d8 43 24                     fadd dword [ebx+0x24]
00515806  d9 c9                        fxch st(1)
00515808  d8 43 28                     fadd dword [ebx+0x28]
0051580b  d9 ca                        fxch st(2)
0051580d  d8 43 2c                     fadd dword [ebx+0x2c]
00515810  d9 c9                        fxch st(1)
00515812  d9 1a                        fstp dword [edx]
00515814  d9 5a 08                     fstp dword [edx+0x8]
00515817  d9 5a 04                     fstp dword [edx+0x4]
0051581a  49                           dec ecx
0051581b  75 82                        jnz short 0x51579f
