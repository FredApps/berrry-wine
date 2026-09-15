; mw3-gameplay-05-0x0051b0be
; runtime 0x0051b0be  module mech3demo.exe  orig 0x0051b0be
; entries 96951  guest ops 34  retired 3296334  1.76% of window

0051b0be  d9 05 4c d9 6f 00            fld dword [0x6fd94c]
0051b0c4  d8 4e fc                     fmul dword [esi-0x4]
0051b0c7  d9 05 40 d9 6f 00            fld dword [0x6fd940]
0051b0cd  d8 4e f8                     fmul dword [esi-0x8]
0051b0d0  de c1                        faddp st(1), st
0051b0d2  d9 05 58 d9 6f 00            fld dword [0x6fd958]
0051b0d8  d8 0e                        fmul dword [esi]
0051b0da  de c1                        faddp st(1), st
0051b0dc  d8 05 64 d9 6f 00            fadd dword [0x6fd964]
0051b0e2  d8 25 e0 d8 6f 00            fsub dword [0x6fd8e0]
0051b0e8  d8 0d 70 79 5b 00            fmul dword [0x5b7970]
0051b0ee  d8 05 84 79 5b 00            fadd dword [0x5b7984]
0051b0f4  d9 05 54 d9 6f 00            fld dword [0x6fd954]
0051b0fa  d8 4e fc                     fmul dword [esi-0x4]
0051b0fd  d9 05 48 d9 6f 00            fld dword [0x6fd948]
0051b103  d8 4e f8                     fmul dword [esi-0x8]
0051b106  de c1                        faddp st(1), st
0051b108  d9 05 60 d9 6f 00            fld dword [0x6fd960]
0051b10e  d8 0e                        fmul dword [esi]
0051b110  de c1                        faddp st(1), st
0051b112  d8 05 6c d9 6f 00            fadd dword [0x6fd96c]
0051b118  d8 25 e8 d8 6f 00            fsub dword [0x6fd8e8]
0051b11e  d8 0d 70 79 5b 00            fmul dword [0x5b7970]
0051b124  d8 05 88 79 5b 00            fadd dword [0x5b7988]
0051b12a  d9 5d a8                     fstp dword [ebp-0x58]
0051b12d  d8 0d f0 89 59 00            fmul dword [0x5989f0]
0051b133  dc 25 f8 89 59 00            fsub qword [0x5989f8]
0051b139  dd 9d 70 ff ff ff            fstp qword [ebp+0xffffff70]
0051b13f  8b 85 70 ff ff ff            mov eax, [ebp+0xffffff70]
0051b145  8b c8                        mov ecx, eax
0051b147  83 e0 3f                     and dword eax, 0x3f
0051b14a  83 e1 40                     and dword ecx, 0x40
0051b14d  83 f8 20                     cmp dword eax, 0x20
0051b150  76 09                        jbe short 0x51b15b
