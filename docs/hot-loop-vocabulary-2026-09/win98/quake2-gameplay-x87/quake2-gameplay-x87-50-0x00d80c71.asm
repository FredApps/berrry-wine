; quake2-gameplay-x87-50-0x00d80c71
; runtime 0x00d80c71  module ref_soft.dll  orig 0x10002c71
; entries 31675  guest ops 24  retired 760200  0.39% of window

10002c71  d9 45 e4                     fld dword [ebp-0x1c]
10002c74  d8 77 24                     fdiv dword [edi+0x24]
10002c77  8b 47 20                     mov eax, [edi+0x20]
10002c7a  8b 47 40                     mov eax, [edi+0x40]
10002c7d  d9 55 e8                     fst dword [ebp-0x18]
10002c80  d8 0d a4 c1 02 10            fmul dword [0x1002c1a4]
10002c86  d9 47 1c                     fld dword [edi+0x1c]
10002c89  d8 0d 4c 87 0e 10            fmul dword [0x100e874c]
10002c8f  d9 47 20                     fld dword [edi+0x20]
10002c92  d8 0d b0 80 0e 10            fmul dword [0x100e80b0]
10002c98  d9 c9                        fxch st(1)
10002c9a  d8 4d e8                     fmul dword [ebp-0x18]
10002c9d  d8 05 b8 81 0e 10            fadd dword [0x100e81b8]
10002ca3  d9 c9                        fxch st(1)
10002ca5  d8 4d e8                     fmul dword [ebp-0x18]
10002ca8  d8 05 d4 b9 0f 10            fadd dword [0x100fb9d4]
10002cae  d9 ca                        fxch st(2)
10002cb0  db 5f 14                     fistp dword [edi+0x14]
10002cb3  db 1f                        fistp dword [edi]
10002cb5  db 5f 04                     fistp dword [edi+0x4]
10002cb8  8b 07                        mov eax, [edi]
10002cba  8b 5f 04                     mov ebx, [edi+0x4]
10002cbd  3b 05 34 81 0e 10            cmp eax, [0x100e8134]
10002cc3  7d 03                        jge short 0x10002cc8
