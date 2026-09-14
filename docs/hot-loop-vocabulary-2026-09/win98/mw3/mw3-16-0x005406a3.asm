; mw3-16-0x005406a3
; runtime 0x005406a3  module mech3demo.exe  orig 0x005406a3
; entries 26637  guest ops 5  retired 133185  1.25% of window

005406a3  d9 05 84 c9 6e 00            fld dword [0x6ec984]
005406a9  d8 1d 10 89 5b 00            fcomp dword [0x5b8910]
005406af  df e0                        fnstsw ax
005406b1  f6 c4 41                     test ah, 0x41
005406b4  75 0a                        jnz short 0x5406c0
