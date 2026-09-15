; mw3-gameplay-22-0x00516333
; runtime 0x00516333  module mech3demo.exe  orig 0x00516333
; entries 27074  guest ops 48  retired 1299552  0.69% of window
; TRUNCATED at --max-ops: no terminator within the window

00516333  8d 84 0d b4 f8 ff ff         lea eax, [ebp+ecx+0xfffff8b4]
0051633a  8d 91 e4 43 70 00            lea edx, [ecx+0x7043e4]
00516340  89 45 f8                     mov [ebp-0x8], eax
00516343  89 55 e0                     mov [ebp-0x20], edx
00516346  8b 45 e0                     mov eax, [ebp-0x20]
00516349  bb 40 d9 6f 00               mov ebx, 0x6fd940
0051634e  8b 55 f8                     mov edx, [ebp-0x8]
00516351  d9 00                        fld dword [eax]
00516353  d8 0b                        fmul dword [ebx]
00516355  d9 00                        fld dword [eax]
00516357  d8 4b 04                     fmul dword [ebx+0x4]
0051635a  d9 00                        fld dword [eax]
0051635c  d8 4b 08                     fmul dword [ebx+0x8]
0051635f  d9 40 04                     fld dword [eax+0x4]
00516362  d8 4b 0c                     fmul dword [ebx+0xc]
00516365  d9 40 04                     fld dword [eax+0x4]
00516368  d8 4b 10                     fmul dword [ebx+0x10]
0051636b  d9 40 04                     fld dword [eax+0x4]
0051636e  d8 4b 14                     fmul dword [ebx+0x14]
00516371  d9 ca                        fxch st(2)
00516373  de c5                        faddp st(5), st
00516375  de c3                        faddp st(3), st
00516377  de c1                        faddp st(1), st
00516379  d9 40 08                     fld dword [eax+0x8]
0051637c  d8 4b 18                     fmul dword [ebx+0x18]
0051637f  d9 40 08                     fld dword [eax+0x8]
00516382  d8 4b 1c                     fmul dword [ebx+0x1c]
00516385  d9 40 08                     fld dword [eax+0x8]
00516388  d8 4b 20                     fmul dword [ebx+0x20]
0051638b  d9 ca                        fxch st(2)
0051638d  de c5                        faddp st(5), st
0051638f  de c3                        faddp st(3), st
00516391  de c1                        faddp st(1), st
00516393  d9 ca                        fxch st(2)
00516395  d8 43 24                     fadd dword [ebx+0x24]
00516398  d9 c9                        fxch st(1)
0051639a  d8 43 28                     fadd dword [ebx+0x28]
0051639d  d9 ca                        fxch st(2)
0051639f  d8 43 2c                     fadd dword [ebx+0x2c]
005163a2  d9 c9                        fxch st(1)
005163a4  d9 1a                        fstp dword [edx]
005163a6  d9 5a 08                     fstp dword [edx+0x8]
005163a9  d9 5a 04                     fstp dword [edx+0x4]
005163ac  d9 85 48 ff ff ff            fld dword [ebp+0xffffff48]
005163b2  d8 9c 0d b8 f8 ff ff         fcomp dword [ebp+ecx+0xfffff8b8]
005163b9  df e0                        fnstsw ax
005163bb  f6 c4 41                     test ah, 0x41
005163be  75 0d                        jnz short 0x5163cd
