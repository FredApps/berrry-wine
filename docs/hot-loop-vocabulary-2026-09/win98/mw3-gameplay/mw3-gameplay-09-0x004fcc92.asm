; mw3-gameplay-09-0x004fcc92
; runtime 0x004fcc92  module mech3demo.exe  orig 0x004fcc92
; entries 51868  guest ops 41  retired 2126588  1.13% of window

004fcc92  8b 15 50 6f 5b 00            mov edx, [0x5b6f50]
004fcc98  89 7d 08                     mov [ebp+0x8], edi
004fcc9b  89 75 f8                     mov [ebp-0x8], esi
004fcc9e  83 c6 0c                     add dword esi, 0xc
004fcca1  8b 02                        mov eax, [edx]
004fcca3  83 c7 0c                     add dword edi, 0xc
004fcca6  89 45 fc                     mov [ebp-0x4], eax
004fcca9  8b 45 f8                     mov eax, [ebp-0x8]
004fccac  8b 5d fc                     mov ebx, [ebp-0x4]
004fccaf  8b 55 08                     mov edx, [ebp+0x8]
004fccb2  d9 00                        fld dword [eax]
004fccb4  d8 0b                        fmul dword [ebx]
004fccb6  d9 00                        fld dword [eax]
004fccb8  d8 4b 04                     fmul dword [ebx+0x4]
004fccbb  d9 00                        fld dword [eax]
004fccbd  d8 4b 08                     fmul dword [ebx+0x8]
004fccc0  d9 40 04                     fld dword [eax+0x4]
004fccc3  d8 4b 0c                     fmul dword [ebx+0xc]
004fccc6  d9 40 04                     fld dword [eax+0x4]
004fccc9  d8 4b 10                     fmul dword [ebx+0x10]
004fcccc  d9 40 04                     fld dword [eax+0x4]
004fcccf  d8 4b 14                     fmul dword [ebx+0x14]
004fccd2  d9 ca                        fxch st(2)
004fccd4  de c5                        faddp st(5), st
004fccd6  de c3                        faddp st(3), st
004fccd8  de c1                        faddp st(1), st
004fccda  d9 40 08                     fld dword [eax+0x8]
004fccdd  d8 4b 18                     fmul dword [ebx+0x18]
004fcce0  d9 40 08                     fld dword [eax+0x8]
004fcce3  d8 4b 1c                     fmul dword [ebx+0x1c]
004fcce6  d9 40 08                     fld dword [eax+0x8]
004fcce9  d8 4b 20                     fmul dword [ebx+0x20]
004fccec  d9 ca                        fxch st(2)
004fccee  de c5                        faddp st(5), st
004fccf0  de c3                        faddp st(3), st
004fccf2  de c1                        faddp st(1), st
004fccf4  d9 5a 08                     fstp dword [edx+0x8]
004fccf7  d9 5a 04                     fstp dword [edx+0x4]
004fccfa  d9 1a                        fstp dword [edx]
004fccfc  49                           dec ecx
004fccfd  75 93                        jnz short 0x4fcc92
