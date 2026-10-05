; mw3-gameplay-x87-20-0x0051b4b1
; runtime 0x0051b4b1  module mech3demo.exe  orig 0x0051b4b1
; entries 51633  guest ops 14  retired 722862  0.66% of window

0051b4b1  d8 0d 78 79 5b 00            fmul dword [0x5b7978]
0051b4b7  d8 4d c0                     fmul dword [ebp-0x40]
0051b4ba  d8 05 74 79 5b 00            fadd dword [0x5b7974]
0051b4c0  d8 4d fc                     fmul dword [ebp-0x4]
0051b4c3  d8 2d d4 89 59 00            fsubr dword [0x5989d4]
0051b4c9  8b 45 14                     mov eax, [ebp+0x14]
0051b4cc  85 c0                        test eax, eax
0051b4ce  d9 c0                        fld st(0)
0051b4d0  d8 03                        fadd dword [ebx]
0051b4d2  d9 1b                        fstp dword [ebx]
0051b4d4  d9 45 a0                     fld dword [ebp-0x60]
0051b4d7  d8 c1                        fadd st, st(1)
0051b4d9  d9 5d a0                     fstp dword [ebp-0x60]
0051b4dc  74 2a                        jz short 0x51b508
