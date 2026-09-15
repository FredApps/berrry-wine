; mw3-gameplay-03-0x00515ad8
; runtime 0x00515ad8  module mech3demo.exe  orig 0x00515ad8
; entries 96736  guest ops 48  retired 4643328  2.48% of window
; TRUNCATED at --max-ops: no terminator within the window

00515ad8  d9 05 fc 43 70 00            fld dword [0x7043fc]
00515ade  d8 25 f0 43 70 00            fsub dword [0x7043f0]
00515ae4  d9 05 00 44 70 00            fld dword [0x704400]
00515aea  d8 25 f4 43 70 00            fsub dword [0x7043f4]
00515af0  d9 05 04 44 70 00            fld dword [0x704404]
00515af6  d8 25 f8 43 70 00            fsub dword [0x7043f8]
00515afc  d9 05 e4 43 70 00            fld dword [0x7043e4]
00515b02  d8 25 f0 43 70 00            fsub dword [0x7043f0]
00515b08  c1 e8 08                     shr eax, 0x8
00515b0b  83 e0 01                     and dword eax, 0x1
00515b0e  8d 4d cc                     lea ecx, [ebp-0x34]
00515b11  8b f0                        mov esi, eax
00515b13  c7 45 f8 e4 43 70 00         mov dword [ebp-0x8], 0x7043e4
00515b1a  d9 9d 1c ff ff ff            fstp dword [ebp+0xffffff1c]
00515b20  d9 05 e8 43 70 00            fld dword [0x7043e8]
00515b26  d8 25 f4 43 70 00            fsub dword [0x7043f4]
00515b2c  89 4d e0                     mov [ebp-0x20], ecx
00515b2f  d9 9d 20 ff ff ff            fstp dword [ebp+0xffffff20]
00515b35  d9 05 ec 43 70 00            fld dword [0x7043ec]
00515b3b  d8 25 f8 43 70 00            fsub dword [0x7043f8]
00515b41  d9 c0                        fld st(0)
00515b43  d8 cb                        fmul st, st(3)
00515b45  d9 85 20 ff ff ff            fld dword [ebp+0xffffff20]
00515b4b  d8 cb                        fmul st, st(3)
00515b4d  de e9                        fsubp st(1), st
00515b4f  d9 5d cc                     fstp dword [ebp-0x34]
00515b52  d9 85 1c ff ff ff            fld dword [ebp+0xffffff1c]
00515b58  d8 ca                        fmul st, st(2)
00515b5a  d9 c9                        fxch st(1)
00515b5c  d8 cc                        fmul st, st(4)
00515b5e  de e9                        fsubp st(1), st
00515b60  d9 5d d0                     fstp dword [ebp-0x30]
00515b63  dd d8                        fstp st(0)
00515b65  d9 85 20 ff ff ff            fld dword [ebp+0xffffff20]
00515b6b  d8 ca                        fmul st, st(2)
00515b6d  d9 85 1c ff ff ff            fld dword [ebp+0xffffff1c]
00515b73  d8 ca                        fmul st, st(2)
00515b75  de e9                        fsubp st(1), st
00515b77  d9 5d d4                     fstp dword [ebp-0x2c]
00515b7a  dd d8                        fstp st(0)
00515b7c  dd d8                        fstp st(0)
00515b7e  8b 4d e0                     mov ecx, [ebp-0x20]
00515b81  8b 55 f8                     mov edx, [ebp-0x8]
00515b84  d9 01                        fld dword [ecx]
00515b86  d8 0a                        fmul dword [edx]
00515b88  d9 41 04                     fld dword [ecx+0x4]
00515b8b  d8 4a 04                     fmul dword [edx+0x4]
00515b8e  d9 41 08                     fld dword [ecx+0x8]
