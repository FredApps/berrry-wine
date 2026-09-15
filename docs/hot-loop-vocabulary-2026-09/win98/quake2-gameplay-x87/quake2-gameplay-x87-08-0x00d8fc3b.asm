; quake2-gameplay-x87-08-0x00d8fc3b
; runtime 0x00d8fc3b  module ref_soft.dll  orig 0x10011c3b
; entries 78197  guest ops 41  retired 3206077  1.63% of window

10011c3b  db 43 04                     fild dword [ebx+0x4]
10011c3e  db 03                        fild dword [ebx]
10011c40  d9 c1                        fld st(1)
10011c42  d8 0d 88 7a 02 10            fmul dword [0x10027a88]
10011c48  d9 c1                        fld st(1)
10011c4a  d8 0d 7c 7a 02 10            fmul dword [0x10027a7c]
10011c50  d9 c2                        fld st(2)
10011c52  d8 0d 80 7a 02 10            fmul dword [0x10027a80]
10011c58  d9 c9                        fxch st(1)
10011c5a  de c2                        faddp st(2), st
10011c5c  d9 c9                        fxch st(1)
10011c5e  d9 c3                        fld st(3)
10011c60  d8 0d 8c 7a 02 10            fmul dword [0x10027a8c]
10011c66  d9 c9                        fxch st(1)
10011c68  d8 05 94 7a 02 10            fadd dword [0x10027a94]
10011c6e  d9 cc                        fxch st(4)
10011c70  d8 0d 90 7a 02 10            fmul dword [0x10027a90]
10011c76  d9 c9                        fxch st(1)
10011c78  de c2                        faddp st(2), st
10011c7a  d9 ca                        fxch st(2)
10011c7c  d8 0d 84 7a 02 10            fmul dword [0x10027a84]
10011c82  d9 c9                        fxch st(1)
10011c84  d8 05 98 7a 02 10            fadd dword [0x10027a98]
10011c8a  d9 ca                        fxch st(2)
10011c8c  de c1                        faddp st(1), st
10011c8e  d9 05 5c 7a 02 10            fld dword [0x10027a5c]
10011c94  d9 c9                        fxch st(1)
10011c96  d8 05 9c 7a 02 10            fadd dword [0x10027a9c]
10011c9c  dc f9                        fdivr st(1), st
10011c9e  8b 0d b8 7a 02 10            mov ecx, [0x10027ab8]
10011ca4  8b 43 04                     mov eax, [ebx+0x4]
10011ca7  89 1d ac 7b 02 10            mov [0x10027bac], ebx
10011cad  8b 15 a4 7a 02 10            mov edx, [0x10027aa4]
10011cb3  8b 35 a0 7a 02 10            mov esi, [0x10027aa0]
10011cb9  8b 3c 85 40 5a 0e 10         mov edi, [0x100e5a40+eax*4]
10011cc0  03 f9                        add edi, ecx
10011cc2  8b 0b                        mov ecx, [ebx]
10011cc4  03 f9                        add edi, ecx
10011cc6  8b 4b 08                     mov ecx, [ebx+0x8]
10011cc9  83 f9 10                     cmp dword ecx, 0x10
10011ccc  77 72                        ja short 0x10011d40
