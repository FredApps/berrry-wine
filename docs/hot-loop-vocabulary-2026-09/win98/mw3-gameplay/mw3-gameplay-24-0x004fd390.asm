; mw3-gameplay-24-0x004fd390
; runtime 0x004fd390  module mech3demo.exe  orig 0x004fd390
; entries 55880  guest ops 22  retired 1229360  0.66% of window

004fd390  8b 44 24 04                  mov eax, [esp+0x4]
004fd394  d9 05 dc 87 59 00            fld dword [0x5987dc]
004fd39a  d8 71 08                     fdiv dword [ecx+0x8]
004fd39d  83 c1 0c                     add dword ecx, 0xc
004fd3a0  83 c2 0c                     add dword edx, 0xc
004fd3a3  48                           dec eax
004fd3a4  d9 c0                        fld st(0)
004fd3a6  d8 49 f4                     fmul dword [ecx-0xc]
004fd3a9  d9 c1                        fld st(1)
004fd3ab  d9 c9                        fxch st(1)
004fd3ad  d8 0d d0 d8 6f 00            fmul dword [0x6fd8d0]
004fd3b3  d8 05 c0 d8 6f 00            fadd dword [0x6fd8c0]
004fd3b9  d9 5a f4                     fstp dword [edx-0xc]
004fd3bc  d9 41 f8                     fld dword [ecx-0x8]
004fd3bf  d8 ca                        fmul st, st(2)
004fd3c1  d8 0d d4 d8 6f 00            fmul dword [0x6fd8d4]
004fd3c7  d8 05 c4 d8 6f 00            fadd dword [0x6fd8c4]
004fd3cd  d9 5a f8                     fstp dword [edx-0x8]
004fd3d0  d8 0d c8 d8 6f 00            fmul dword [0x6fd8c8]
004fd3d6  d9 5a fc                     fstp dword [edx-0x4]
004fd3d9  dd d8                        fstp st(0)
004fd3db  75 b7                        jnz short 0x4fd394
