; mw3-10-0x005406c0
; runtime 0x005406c0  module mech3demo.exe  orig 0x005406c0
; entries 26637  guest ops 7  retired 186459  1.74% of window

005406c0  d9 05 88 c9 6e 00            fld dword [0x6ec988]
005406c6  d8 05 84 c9 6e 00            fadd dword [0x6ec984]
005406cc  d9 c9                        fxch st(1)
005406ce  d9 1d 18 89 5b 00            fstp dword [0x5b8918]
005406d4  d9 1d 88 c9 6e 00            fstp dword [0x6ec988]
005406da  83 c4 08                     add dword esp, 0x8
005406dd  c3                           ret
