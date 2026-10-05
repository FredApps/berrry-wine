; mw3-gameplay-18-0x004a4790
; runtime 0x004a4790  module mech3demo.exe  orig 0x004a4790
; entries 31680  guest ops 48  retired 1520640  0.81% of window
; TRUNCATED at --max-ops: no terminator within the window

004a4790  83 ec 0c                     sub dword esp, 0xc
004a4793  53                           push ebx
004a4794  55                           push ebp
004a4795  56                           push esi
004a4796  8b 74 24 1c                  mov esi, [esp+0x1c]
004a479a  57                           push edi
004a479b  8b 7c 24 24                  mov edi, [esp+0x24]
004a479f  d9 06                        fld dword [esi]
004a47a1  d8 27                        fsub dword [edi]
004a47a3  d9 46 08                     fld dword [esi+0x8]
004a47a6  d8 67 08                     fsub dword [edi+0x8]
004a47a9  d9 c9                        fxch st(1)
004a47ab  d9 54 24 10                  fst dword [esp+0x10]
004a47af  d9 c1                        fld st(1)
004a47b1  d8 09                        fmul dword [ecx]
004a47b3  d9 c9                        fxch st(1)
004a47b5  d8 49 08                     fmul dword [ecx+0x8]
004a47b8  d9 06                        fld dword [esi]
004a47ba  d8 4f 08                     fmul dword [edi+0x8]
004a47bd  d9 07                        fld dword [edi]
004a47bf  d9 ca                        fxch st(2)
004a47c1  de eb                        fsubp st(3), st
004a47c3  d9 c9                        fxch st(1)
004a47c5  d8 4e 08                     fmul dword [esi+0x8]
004a47c8  d9 c9                        fxch st(1)
004a47ca  de c2                        faddp st(2), st
004a47cc  d9 44 24 10                  fld dword [esp+0x10]
004a47d0  d9 c9                        fxch st(1)
004a47d2  de ea                        fsubp st(2), st
004a47d4  d9 c9                        fxch st(1)
004a47d6  8b 5c 24 28                  mov ebx, [esp+0x28]
004a47da  8b 6c 24 2c                  mov ebp, [esp+0x2c]
004a47de  d9 1b                        fstp dword [ebx]
004a47e0  d9 c9                        fxch st(1)
004a47e2  d8 0a                        fmul dword [edx]
004a47e4  d9 06                        fld dword [esi]
004a47e6  d9 ca                        fxch st(2)
004a47e8  d8 4a 08                     fmul dword [edx+0x8]
004a47eb  d9 07                        fld dword [edi]
004a47ed  d9 cb                        fxch st(3)
004a47ef  d8 4f 08                     fmul dword [edi+0x8]
004a47f2  d9 c9                        fxch st(1)
004a47f4  de ea                        fsubp st(2), st
004a47f6  d9 ca                        fxch st(2)
004a47f8  d8 4e 08                     fmul dword [esi+0x8]
004a47fb  d9 ca                        fxch st(2)
004a47fd  de c1                        faddp st(1), st
004a47ff  d9 c9                        fxch st(1)
