; mw3-gameplay-20-0x0051b174
; runtime 0x0051b174  module mech3demo.exe  orig 0x0051b174
; entries 96951  guest ops 15  retired 1454265  0.78% of window

0051b174  d8 0d 78 79 5b 00            fmul dword [0x5b7978]
0051b17a  8b 4d d4                     mov ecx, [ebp-0x2c]
0051b17d  d8 4d d8                     fmul dword [ebp-0x28]
0051b180  d8 05 74 79 5b 00            fadd dword [0x5b7974]
0051b186  d8 0c 39                     fmul dword [ecx+edi]
0051b189  d8 2d d4 89 59 00            fsubr dword [0x5989d4]
0051b18f  d9 c0                        fld st(0)
0051b191  d8 07                        fadd dword [edi]
0051b193  8b 45 14                     mov eax, [ebp+0x14]
0051b196  85 c0                        test eax, eax
0051b198  d9 1f                        fstp dword [edi]
0051b19a  d9 45 ec                     fld dword [ebp-0x14]
0051b19d  d8 c1                        fadd st, st(1)
0051b19f  d9 5d ec                     fstp dword [ebp-0x14]
0051b1a2  74 2a                        jz short 0x51b1ce
