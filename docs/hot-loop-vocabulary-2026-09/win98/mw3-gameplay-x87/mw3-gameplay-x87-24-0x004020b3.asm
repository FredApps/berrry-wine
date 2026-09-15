; mw3-gameplay-x87-24-0x004020b3
; runtime 0x004020b3  module mech3demo.exe  orig 0x004020b3
; entries 45531  guest ops 15  retired 682965  0.62% of window

004020b3  d9 e8                        fld1
004020b5  de f1                        fdivrp st(1), st
004020b7  d9 c0                        fld st(0)
004020b9  d8 09                        fmul dword [ecx]
004020bb  d9 c1                        fld st(1)
004020bd  d8 49 04                     fmul dword [ecx+0x4]
004020c0  d9 ca                        fxch st(2)
004020c2  d8 49 08                     fmul dword [ecx+0x8]
004020c5  d9 c9                        fxch st(1)
004020c7  d9 19                        fstp dword [ecx]
004020c9  d9 c9                        fxch st(1)
004020cb  d9 59 04                     fstp dword [ecx+0x4]
004020ce  d9 59 08                     fstp dword [ecx+0x8]
004020d1  d9 45 fc                     fld dword [ebp-0x4]
004020d4  eb 05                        jmp short 0x4020db
