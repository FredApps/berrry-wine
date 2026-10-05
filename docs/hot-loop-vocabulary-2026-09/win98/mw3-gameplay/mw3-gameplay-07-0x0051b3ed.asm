; mw3-gameplay-07-0x0051b3ed
; runtime 0x0051b3ed  module mech3demo.exe  orig 0x0051b3ed
; entries 67245  guest ops 34  retired 2286330  1.22% of window

0051b3ed  d9 05 58 d9 6f 00            fld dword [0x6fd958]
0051b3f3  d8 8e ec 43 70 00            fmul dword [esi+0x7043ec]
0051b3f9  d9 05 4c d9 6f 00            fld dword [0x6fd94c]
0051b3ff  d8 8e e8 43 70 00            fmul dword [esi+0x7043e8]
0051b405  de c1                        faddp st(1), st
0051b407  d9 05 40 d9 6f 00            fld dword [0x6fd940]
0051b40d  d8 8e e4 43 70 00            fmul dword [esi+0x7043e4]
0051b413  de c1                        faddp st(1), st
0051b415  d8 05 64 d9 6f 00            fadd dword [0x6fd964]
0051b41b  d8 25 e0 d8 6f 00            fsub dword [0x6fd8e0]
0051b421  d8 0d 70 79 5b 00            fmul dword [0x5b7970]
0051b427  d8 05 84 79 5b 00            fadd dword [0x5b7984]
0051b42d  d9 05 60 d9 6f 00            fld dword [0x6fd960]
0051b433  d8 8e ec 43 70 00            fmul dword [esi+0x7043ec]
0051b439  d9 05 54 d9 6f 00            fld dword [0x6fd954]
0051b43f  d8 8e e8 43 70 00            fmul dword [esi+0x7043e8]
0051b445  de c1                        faddp st(1), st
0051b447  d9 05 48 d9 6f 00            fld dword [0x6fd948]
0051b44d  d8 8e e4 43 70 00            fmul dword [esi+0x7043e4]
0051b453  de c1                        faddp st(1), st
0051b455  d8 05 6c d9 6f 00            fadd dword [0x6fd96c]
0051b45b  d8 25 e8 d8 6f 00            fsub dword [0x6fd8e8]
0051b461  d8 0d 70 79 5b 00            fmul dword [0x5b7970]
0051b467  d8 05 88 79 5b 00            fadd dword [0x5b7988]
0051b46d  d9 5d f8                     fstp dword [ebp-0x8]
0051b470  d8 0d f0 89 59 00            fmul dword [0x5989f0]
0051b476  dc 25 f8 89 59 00            fsub qword [0x5989f8]
0051b47c  dd 5d bc                     fstp qword [ebp-0x44]
0051b47f  8b 45 bc                     mov eax, [ebp-0x44]
0051b482  8b c8                        mov ecx, eax
0051b484  83 e0 3f                     and dword eax, 0x3f
0051b487  83 e1 40                     and dword ecx, 0x40
0051b48a  83 f8 20                     cmp dword eax, 0x20
0051b48d  76 09                        jbe short 0x51b498
