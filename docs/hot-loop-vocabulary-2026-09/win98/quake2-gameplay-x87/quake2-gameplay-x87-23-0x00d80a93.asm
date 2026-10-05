; quake2-gameplay-x87-23-0x00d80a93
; runtime 0x00d80a93  module ref_soft.dll  orig 0x10002a93
; entries 31550  guest ops 46  retired 1451300  0.74% of window

10002a93  8b 75 10                     mov esi, [ebp+0x10]
10002a96  8b 7d 14                     mov edi, [ebp+0x14]
10002a99  33 db                        xor ebx, ebx
10002a9b  8a 1e                        mov bl, [esi]
10002a9d  89 5d f8                     mov [ebp-0x8], ebx
10002aa0  db 45 f8                     fild dword [ebp-0x8]
10002aa3  d8 0d 30 87 11 10            fmul dword [0x10118730]
10002aa9  8a 5e 01                     mov bl, [esi+0x1]
10002aac  89 5d f8                     mov [ebp-0x8], ebx
10002aaf  db 45 f8                     fild dword [ebp-0x8]
10002ab2  d8 0d 34 87 11 10            fmul dword [0x10118734]
10002ab8  8a 5e 02                     mov bl, [esi+0x2]
10002abb  89 5d f8                     mov [ebp-0x8], ebx
10002abe  db 45 f8                     fild dword [ebp-0x8]
10002ac1  d8 0d 38 87 11 10            fmul dword [0x10118738]
10002ac7  8a 1f                        mov bl, [edi]
10002ac9  89 5d f8                     mov [ebp-0x8], ebx
10002acc  db 45 f8                     fild dword [ebp-0x8]
10002acf  d8 0d d0 85 11 10            fmul dword [0x101185d0]
10002ad5  8a 5f 01                     mov bl, [edi+0x1]
10002ad8  89 5d f8                     mov [ebp-0x8], ebx
10002adb  db 45 f8                     fild dword [ebp-0x8]
10002ade  d8 0d d4 85 11 10            fmul dword [0x101185d4]
10002ae4  8a 5f 02                     mov bl, [edi+0x2]
10002ae7  89 5d f8                     mov [ebp-0x8], ebx
10002aea  db 45 f8                     fild dword [ebp-0x8]
10002aed  d8 0d d8 85 11 10            fmul dword [0x101185d8]
10002af3  d9 cd                        fxch st(5)
10002af5  de c2                        faddp st(2), st
10002af7  de c3                        faddp st(3), st
10002af9  d9 c9                        fxch st(1)
10002afb  de c3                        faddp st(3), st
10002afd  d8 05 e0 85 11 10            fadd dword [0x101185e0]
10002b03  d9 c9                        fxch st(1)
10002b05  d8 05 e4 85 11 10            fadd dword [0x101185e4]
10002b0b  d9 ca                        fxch st(2)
10002b0d  d8 05 e8 85 11 10            fadd dword [0x101185e8]
10002b13  d9 c9                        fxch st(1)
10002b15  d9 5d ec                     fstp dword [ebp-0x14]
10002b18  d9 5d f4                     fstp dword [ebp-0xc]
10002b1b  d9 5d f0                     fstp dword [ebp-0x10]
10002b1e  a1 bc 85 11 10               mov eax, [0x101185bc]
10002b23  8b 40 44                     mov eax, [eax+0x44]
10002b26  bb 00 1c 00 00               mov ebx, 0x1c00
10002b2b  23 c3                        and eax, ebx
10002b2d  74 44                        jz short 0x10002b73
