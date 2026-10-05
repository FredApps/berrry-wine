; mw3-gameplay-x87-26-0x004fd9f0
; runtime 0x004fd9f0  module mech3demo.exe  orig 0x004fd9f0
; entries 11553  guest ops 58  retired 670074  0.61% of window

004fd9f0  55                           push ebp
004fd9f1  8b ec                        mov ebp, esp
004fd9f3  83 ec 0c                     sub dword esp, 0xc
004fd9f6  53                           push ebx
004fd9f7  56                           push esi
004fd9f8  57                           push edi
004fd9f9  89 55 f4                     mov [ebp-0xc], edx
004fd9fc  89 4d f8                     mov [ebp-0x8], ecx
004fd9ff  8b 45 f8                     mov eax, [ebp-0x8]
004fda02  8b 5d f4                     mov ebx, [ebp-0xc]
004fda05  8b 4d 08                     mov ecx, [ebp+0x8]
004fda08  8b 55 0c                     mov edx, [ebp+0xc]
004fda0b  d9 01                        fld dword [ecx]
004fda0d  d8 20                        fsub dword [eax]
004fda0f  d9 41 04                     fld dword [ecx+0x4]
004fda12  d8 60 04                     fsub dword [eax+0x4]
004fda15  d9 41 08                     fld dword [ecx+0x8]
004fda18  d8 60 08                     fsub dword [eax+0x8]
004fda1b  d9 ca                        fxch st(2)
004fda1d  d9 5d fc                     fstp dword [ebp-0x4]
004fda20  d9 03                        fld dword [ebx]
004fda22  d8 20                        fsub dword [eax]
004fda24  d9 43 04                     fld dword [ebx+0x4]
004fda27  d8 60 04                     fsub dword [eax+0x4]
004fda2a  d9 43 08                     fld dword [ebx+0x8]
004fda2d  d8 60 08                     fsub dword [eax+0x8]
004fda30  d9 c2                        fld st(2)
004fda32  d8 cc                        fmul st, st(4)
004fda34  d9 ca                        fxch st(2)
004fda36  d9 c0                        fld st(0)
004fda38  d8 ce                        fmul st, st(6)
004fda3a  d9 ca                        fxch st(2)
004fda3c  d9 c0                        fld st(0)
004fda3e  d8 4d fc                     fmul dword [ebp-0x4]
004fda41  d9 cd                        fxch st(5)
004fda43  de cf                        fmulp st(7), st
004fda45  d9 c9                        fxch st(1)
004fda47  d8 4d fc                     fmul dword [ebp-0x4]
004fda4a  d9 ce                        fxch st(6)
004fda4c  de ec                        fsubp st(4), st
004fda4e  de cc                        fmulp st(4), st
004fda50  d9 cc                        fxch st(4)
004fda52  de e9                        fsubp st(1), st
004fda54  d9 ca                        fxch st(2)
004fda56  de eb                        fsubp st(3), st
004fda58  d9 c2                        fld st(2)
004fda5a  dc c8                        fmul st(0), st
004fda5c  d9 c1                        fld st(1)
004fda5e  dc c8                        fmul st(0), st
004fda60  d9 c3                        fld st(3)
004fda62  dc c8                        fmul st(0), st
004fda64  d9 c9                        fxch st(1)
004fda66  de c2                        faddp st(2), st
004fda68  de c1                        faddp st(1), st
004fda6a  d9 fa                        fsqrt
004fda6c  d9 55 fc                     fst dword [ebp-0x4]
004fda6f  f7 45 fc ff ff ff 7f         test [ebp-0x4], 0x7fffffff
004fda76  74 1c                        jz short 0x4fda94
