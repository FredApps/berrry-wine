; mw3long-16-0x00563c60
; runtime 0x00563c60  module mech3demo.exe  orig 0x00563c60
; entries 42540  guest ops 7  retired 297780  0.11% of window

00563c60  d9 41 0c                     fld dword [ecx+0xc]
00563c63  d8 41 08                     fadd dword [ecx+0x8]
00563c66  dd 44 24 04                  fld qword [esp+0x4]
00563c6a  de d9                        fcompp
00563c6c  df e0                        fnstsw ax
00563c6e  f6 c4 01                     test ah, 0x1
00563c71  74 08                        jz short 0x563c7b
