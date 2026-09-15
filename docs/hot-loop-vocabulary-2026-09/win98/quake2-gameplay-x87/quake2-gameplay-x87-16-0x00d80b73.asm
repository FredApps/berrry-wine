; quake2-gameplay-x87-16-0x00d80b73
; runtime 0x00d80b73  module ref_soft.dll  orig 0x10002b73
; entries 31783  guest ops 57  retired 1811631  0.92% of window

10002b73  8b 45 0c                     mov eax, [ebp+0xc]
10002b76  c7 40 18 00 00 00 00         mov dword [eax+0x18], 0x0
10002b7d  d9 45 ec                     fld dword [ebp-0x14]
10002b80  d8 0d e0 86 11 10            fmul dword [0x101186e0]
10002b86  d9 45 f0                     fld dword [ebp-0x10]
10002b89  d8 0d e4 86 11 10            fmul dword [0x101186e4]
10002b8f  d9 45 f4                     fld dword [ebp-0xc]
10002b92  d8 0d e8 86 11 10            fmul dword [0x101186e8]
10002b98  d9 ca                        fxch st(2)
10002b9a  de c1                        faddp st(1), st
10002b9c  de c1                        faddp st(1), st
10002b9e  d8 05 ec 86 11 10            fadd dword [0x101186ec]
10002ba4  d9 45 ec                     fld dword [ebp-0x14]
10002ba7  d8 0d f0 86 11 10            fmul dword [0x101186f0]
10002bad  d9 45 f0                     fld dword [ebp-0x10]
10002bb0  d8 0d f4 86 11 10            fmul dword [0x101186f4]
10002bb6  d9 45 f4                     fld dword [ebp-0xc]
10002bb9  d8 0d f8 86 11 10            fmul dword [0x101186f8]
10002bbf  d9 ca                        fxch st(2)
10002bc1  de c1                        faddp st(1), st
10002bc3  de c1                        faddp st(1), st
10002bc5  d8 05 fc 86 11 10            fadd dword [0x101186fc]
10002bcb  d9 c9                        fxch st(1)
10002bcd  d9 58 1c                     fstp dword [eax+0x1c]
10002bd0  d9 45 ec                     fld dword [ebp-0x14]
10002bd3  d8 0d 00 87 11 10            fmul dword [0x10118700]
10002bd9  d9 45 f0                     fld dword [ebp-0x10]
10002bdc  d8 0d 04 87 11 10            fmul dword [0x10118704]
10002be2  d9 45 f4                     fld dword [ebp-0xc]
10002be5  d8 0d 08 87 11 10            fmul dword [0x10118708]
10002beb  d9 ca                        fxch st(2)
10002bed  de c1                        faddp st(1), st
10002bef  de c1                        faddp st(1), st
10002bf1  d8 05 0c 87 11 10            fadd dword [0x1011870c]
10002bf7  d9 c9                        fxch st(1)
10002bf9  d9 58 20                     fstp dword [eax+0x20]
10002bfc  d9 58 24                     fstp dword [eax+0x24]
10002bff  33 db                        xor ebx, ebx
10002c01  8a 5f 03                     mov bl, [edi+0x3]
10002c04  b8 0c 00 00 00               mov eax, 0xc
10002c09  f7 e3                        mul ebx
10002c0b  8d 80 a8 20 02 10            lea eax, [eax+0x100220a8]
10002c11  8d 1d 20 87 11 10            lea ebx, [0x10118720]
10002c17  d9 00                        fld dword [eax]
10002c19  d8 0b                        fmul dword [ebx]
10002c1b  d9 40 04                     fld dword [eax+0x4]
10002c1e  d8 4b 04                     fmul dword [ebx+0x4]
10002c21  d9 40 08                     fld dword [eax+0x8]
10002c24  d8 4b 08                     fmul dword [ebx+0x8]
10002c27  d9 ca                        fxch st(2)
10002c29  de c1                        faddp st(1), st
10002c2b  de c1                        faddp st(1), st
10002c2d  d9 5d e0                     fstp dword [ebp-0x20]
10002c30  8b 45 e0                     mov eax, [ebp-0x20]
10002c33  8b 1d d4 86 11 10            mov ebx, [0x101186d4]
10002c39  0b c0                        or eax, eax
10002c3b  79 18                        jns short 0x10002c55
